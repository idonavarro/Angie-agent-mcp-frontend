import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";

const MAX_LOG_STRING = 8_000;
const MAX_SSE_CHUNK_LOG = 4_000;

export function isMcpTrafficLogEnabled(): boolean {
  const flag = process.env.MCP_LOG_TRAFFIC?.toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  if (flag === "false" || flag === "0" || flag === "no") return false;
  const level = process.env.LOG_LEVEL?.toLowerCase() ?? "info";
  return level === "debug" || level === "trace";
}

const REDACTED = "[REDACTED]";

function truncate(str: string, max = MAX_LOG_STRING): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}… [truncated ${str.length - max} chars]`;
}

function redactBase64InString(text: string): string {
  return text.replace(/"data"\s*:\s*"[A-Za-z0-9+/=]{200,}"/g, '"data":"[base64 omitted]"');
}

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[max depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 200))) {
      return `[base64 ${value.length} chars]`;
    }
    return truncate(value);
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "token" ||
      lower === "access_token" ||
      lower === "mcp_auth_token"
    ) {
      out[key] = REDACTED;
      continue;
    }
    if (lower === "data" && typeof val === "string" && val.length > 500) {
      out[key] = `[base64 ${val.length} chars]`;
      continue;
    }
    out[key] = sanitizeForLog(val, depth + 1);
  }
  return out;
}

export function sanitizeHeaders(
  headers: IncomingMessage["headers"] | Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "x-mcp-token") {
      out[key] = REDACTED;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function parseSsePayload(text: string): unknown {
  const dataLines = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim());
  if (dataLines.length === 0) return truncate(redactBase64InString(text), MAX_SSE_CHUNK_LOG);
  const parsed: unknown[] = [];
  for (const line of dataLines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      parsed.push(truncate(redactBase64InString(line)));
    }
  }
  return sanitizeForLog(parsed.length === 1 ? parsed[0] : parsed);
}

export function sanitizeResponseBody(
  statusCode: number,
  headers: Record<string, unknown>,
  rawBody: string
): unknown {
  const contentType = String(headers["content-type"] ?? "");
  if (contentType.includes("text/event-stream")) {
    return { sse: parseSsePayload(rawBody), raw_length: rawBody.length };
  }
  try {
    return sanitizeForLog(JSON.parse(rawBody));
  } catch {
    return truncate(redactBase64InString(rawBody));
  }
}

export function logMcpInbound(
  logger: Logger,
  meta: {
    requestId: string;
    method: string;
    path: string;
    query: unknown;
    headers: Record<string, unknown>;
    body: unknown;
    sessionId?: string;
  }
): void {
  logger.info(
    {
      direction: "in",
      mcp: true,
      requestId: meta.requestId,
      method: meta.method,
      path: meta.path,
      query: sanitizeForLog(meta.query),
      headers: sanitizeHeaders(meta.headers),
      sessionId: meta.sessionId ?? null,
      body: sanitizeForLog(meta.body),
    },
    "MCP traffic"
  );
}

export function logMcpOutbound(
  logger: Logger,
  meta: {
    requestId: string;
    method: string;
    statusCode: number;
    headers: Record<string, unknown>;
    body: unknown;
    durationMs: number;
    sessionId?: string;
  }
): void {
  logger.info(
    {
      direction: "out",
      mcp: true,
      requestId: meta.requestId,
      method: meta.method,
      statusCode: meta.statusCode,
      headers: sanitizeHeaders(meta.headers),
      sessionId: meta.sessionId ?? null,
      durationMs: meta.durationMs,
      body: meta.body,
    },
    "MCP traffic"
  );
}

/** Wrap Node ServerResponse to capture body for logging. */
export function wrapResponseForTrafficLog(
  res: ServerResponse,
  logger: Logger,
  meta: { requestId: string; method: string; sessionId?: string }
): void {
  const chunks: Buffer[] = [];
  const start = Date.now();

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  const flushLog = () => {
    if ((res as ServerResponse & { _mcpLogged?: boolean })._mcpLogged) return;
    (res as ServerResponse & { _mcpLogged?: boolean })._mcpLogged = true;

    const raw = Buffer.concat(chunks).toString("utf8");
    const headers: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(res.getHeaders())) {
      headers[k] = v;
    }

    logMcpOutbound(logger, {
      requestId: meta.requestId,
      method: meta.method,
      statusCode: res.statusCode,
      headers,
      body: sanitizeResponseBody(res.statusCode, headers, raw),
      durationMs: Date.now() - start,
      sessionId: meta.sessionId,
    });
  };

  res.write = function (chunk: unknown, ...args: unknown[]) {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
  };

  res.end = function (chunk: unknown, ...args: unknown[]) {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    flushLog();
    return (originalEnd as (...a: unknown[]) => ServerResponse)(chunk, ...args);
  };

  res.on("close", () => {
    if (chunks.length > 0) flushLog();
  });
}
