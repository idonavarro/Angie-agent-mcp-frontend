import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createMcpServer,
  MCP_VERSION,
  MCP_NAME,
  MCP_DESCRIPTION,
} from "./mcp-server.js";
import { createAuthHook, type AuthMode } from "./security/auth.js";
import { createRateLimitHook, rateLimiter } from "./security/rate-limit.js";
import {
  isMcpTrafficLogEnabled,
  logMcpInbound,
  wrapResponseForTrafficLog,
} from "./mcp/traffic-log.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "";
const ALLOW_INSECURE_HTTP = process.env.ALLOW_INSECURE_HTTP === "true";
const ALLOW_PRIVATE_URLS = process.env.ALLOW_PRIVATE_URLS === "true";
const MCP_ENDPOINT_PATH = normalizePath(process.env.MCP_ENDPOINT_PATH ?? "/mcp");
const MCP_ENDPOINT_ALIASES = (process.env.MCP_ENDPOINT_ALIASES ?? "/api")
  .split(",")
  .map((p) => normalizePath(p.trim()))
  .filter((p) => p.length > 0 && p !== MCP_ENDPOINT_PATH);
const MCP_AUTH_MODE = parseAuthMode(process.env.MCP_AUTH_MODE ?? "bearer_or_query");

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed.replace(/\/+$/, "") || "/";
}

function parseAuthMode(value: string): AuthMode {
  if (value === "bearer" || value === "query" || value === "bearer_or_query") {
    return value;
  }
  return "bearer_or_query";
}

function angieServerUrl(baseUrl: string, token: string, endpointPath: string): string {
  const url = new URL(endpointPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

if (!MCP_AUTH_TOKEN) {
  console.error("MCP_AUTH_TOKEN environment variable is required");
  process.exit(1);
}

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["req.headers.authorization", "req.query.token", "req.query.access_token"],
});

const allowlistOptions = {
  allowInsecureHttp: ALLOW_INSECURE_HTTP,
  allowPrivateUrls: ALLOW_PRIVATE_URLS,
};

const transports = new Map<string, StreamableHTTPServerTransport>();

async function main(): Promise<void> {
  const app = Fastify({
    logger: false,
    bodyLimit: 4 * 1024 * 1024,
  });

  app.get("/health", async () => ({
    status: "ok",
    version: MCP_VERSION,
  }));

  app.get("/", async () => ({
    name: MCP_NAME,
    version: MCP_VERSION,
    description: MCP_DESCRIPTION,
    mcp_endpoint: MCP_ENDPOINT_PATH,
    mcp_endpoint_aliases: MCP_ENDPOINT_ALIASES,
    transport: "http-sse-streamable",
    angie_registration: {
      name: "Browser Layout Scanner",
      description: MCP_DESCRIPTION,
      server_url_example: angieServerUrl(
        "https://YOUR_HOST",
        "YOUR_MCP_AUTH_TOKEN",
        MCP_ENDPOINT_PATH
      ),
      site_scoped_tools: true,
    },
    health: "/health",
  }));

  const authHook = createAuthHook(MCP_AUTH_TOKEN, MCP_AUTH_MODE);
  const rateLimitHook = createRateLimitHook(rateLimiter);

  async function handleMcpRequest(
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply
  ): Promise<void> {
    const mcpLog = isMcpTrafficLogEnabled();
    const requestId = randomUUID().slice(0, 8);
    const sessionHeader = request.headers["mcp-session-id"] as string | undefined;

    if (mcpLog) {
      logMcpInbound(logger, {
        requestId,
        method: request.method,
        path: request.url,
        query: request.query,
        headers: request.headers as Record<string, unknown>,
        body: request.body,
        sessionId: sessionHeader,
      });
      wrapResponseForTrafficLog(reply.raw, logger, {
        requestId,
        method: request.method,
        sessionId: sessionHeader,
      });
    }

    await authHook(request, reply);
    if (reply.sent) return;

    await rateLimitHook(request, reply);
    if (reply.sent) return;

    try {
      const sessionId = sessionHeader;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && request.method === "POST") {
        const mcpServer = createMcpServer({ allowlistOptions, logger });

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            transports.set(sid, transport);
            logger.info({ sessionId: sid }, "MCP session initialized");
          },
        });

        mcpServer.server.onclose = async () => {
          const sid = transport.sessionId;
          if (sid && transports.has(sid)) {
            transports.delete(sid);
            logger.info({ sessionId: sid }, "MCP session closed");
          }
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
        return;
      } else {
        reply.code(400).send({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
        });
        return;
      }

      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      logger.error({ err }, "MCP request error");
      if (!reply.sent) {
        reply.code(500).send({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
        });
      }
    }
  }

  const mcpPaths = [MCP_ENDPOINT_PATH, ...MCP_ENDPOINT_ALIASES];
  for (const path of mcpPaths) {
    app.post(path, handleMcpRequest);
    app.get(path, handleMcpRequest);
    app.delete(path, handleMcpRequest);
  }

  await app.listen({ port: PORT, host: "0.0.0.0" });
  logger.info(
    {
      port: PORT,
      mcpPaths,
      mcpTrafficLog: isMcpTrafficLogEnabled(),
      logLevel: process.env.LOG_LEVEL ?? "info",
    },
    "angie-browser-layout-mcp listening"
  );
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});

process.on("SIGINT", async () => {
  logger.info("Shutting down...");
  for (const [sessionId, transport] of transports) {
    try {
      await transport.close();
      transports.delete(sessionId);
    } catch (err) {
      logger.warn({ err, sessionId }, "Error closing transport");
    }
  }
  process.exit(0);
});

process.on("SIGTERM", () => process.emit("SIGINT"));
