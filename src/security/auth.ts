import type { FastifyRequest, FastifyReply } from "fastify";

export type AuthMode = "bearer" | "query" | "bearer_or_query";

export function extractAuthToken(
  request: Pick<FastifyRequest, "headers" | "query">
): string | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  const query = request.query as Record<string, unknown>;
  const tokenParam = query.token ?? query.access_token;
  if (typeof tokenParam === "string" && tokenParam.length > 0) {
    return tokenParam;
  }

  const headerToken = request.headers["x-mcp-token"];
  if (typeof headerToken === "string" && headerToken.length > 0) {
    return headerToken;
  }

  return null;
}

export function createAuthHook(expectedToken: string, mode: AuthMode = "bearer_or_query") {
  return async function authHook(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = extractAuthToken(request);

    if (!token) {
      const hint =
        mode === "query"
          ? "Provide ?token=YOUR_MCP_AUTH_TOKEN in the Server URL"
          : "Provide Authorization: Bearer token or ?token= in the Server URL";
      reply.code(401).send({ error: "Missing authentication", hint });
      return;
    }

    if (token !== expectedToken) {
      reply.code(401).send({ error: "Invalid authentication token" });
    }
  };
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length);
}
