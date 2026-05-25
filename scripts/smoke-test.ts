#!/usr/bin/env tsx
/**
 * Smoke test: health check + MCP initialize + layout_scan tool call.
 *
 * Usage:
 *   MCP_AUTH_TOKEN=secret tsx scripts/smoke-test.ts
 *   BASE_URL=http://localhost:8080 MCP_AUTH_TOKEN=secret tsx scripts/smoke-test.ts
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "test-token";
const MCP_ENDPOINT = process.env.MCP_ENDPOINT ?? "/mcp";
const MCP_URL =
  process.env.MCP_URL ??
  `${BASE_URL}${MCP_ENDPOINT}${MCP_ENDPOINT.includes("?") ? "&" : "?"}token=${encodeURIComponent(MCP_AUTH_TOKEN)}`;
const SCAN_URL = process.env.SCAN_URL;
const ALLOWED_HOSTS = process.env.ALLOWED_HOSTS;

function parseSseJson(text: string): unknown {
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  const text = await res.text();
  if (contentType.includes("text/event-stream")) {
    return parseSseJson(text) ?? text;
  }
  return text;
}

async function request(
  method: string,
  pathOrUrl: string,
  body?: unknown,
  sessionId?: string
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const parsed = await parseResponseBody(res);
  return { status: res.status, headers: res.headers, body: parsed };
}

function pass(msg: string): void {
  console.log(`✓ ${msg}`);
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`Smoke test against ${MCP_URL}\n`);

  const health = await fetch(`${BASE_URL}/health`);
  if (health.status !== 200) fail(`/health returned ${health.status}`);
  const healthBody = (await health.json()) as { status: string; version: string };
  if (healthBody.status !== "ok") fail(`/health status not ok`);
  pass(`/health → ${JSON.stringify(healthBody)}`);

  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    },
  };

  const initRes = await request("POST", MCP_URL, initBody);
  if (initRes.status !== 200) fail(`MCP initialize returned ${initRes.status}: ${JSON.stringify(initRes.body)}`);

  const sessionId = initRes.headers.get("mcp-session-id");
  if (!sessionId) fail("No mcp-session-id header in initialize response");
  pass(`MCP initialize → session ${sessionId}`);

  const initializedNotification = {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  };
  await request("POST", MCP_URL, initializedNotification, sessionId);

  const listToolsBody = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  };
  const toolsRes = await request("POST", MCP_URL, listToolsBody, sessionId);
  if (toolsRes.status !== 200) fail(`tools/list returned ${toolsRes.status}`);

  const toolsPayload = toolsRes.body as { result?: { tools?: Array<{ name: string }> } };
  const toolNames = toolsPayload.result?.tools?.map((t) => t.name) ?? [];
  if (!toolNames.includes("layout_scan")) fail("layout_scan tool not registered");
  if (!toolNames.includes("layout_scan_multi_viewport")) fail("layout_scan_multi_viewport not registered");
  pass(`tools/list → ${toolNames.join(", ")}`);

  if (SCAN_URL && ALLOWED_HOSTS) {
    const callBody = {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "layout_scan",
        arguments: {
          url: SCAN_URL,
          viewport_width: 375,
          allowed_hosts: ALLOWED_HOSTS.split(",").map((h) => h.trim()),
        },
      },
    };
    const callRes = await request("POST", MCP_URL, callBody, sessionId);
    if (callRes.status !== 200) fail(`tools/call returned ${callRes.status}`);
    pass(`layout_scan against ${SCAN_URL}`);
  } else {
    console.log("\nSkipping live layout_scan (set SCAN_URL + ALLOWED_HOSTS to test against a real page)");
  }

  console.log("\nAll smoke checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
