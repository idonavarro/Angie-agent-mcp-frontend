import { describe, it, expect } from "vitest";
import { sanitizeForLog, sanitizeResponseBody } from "../src/mcp/traffic-log.js";

describe("traffic-log", () => {
  it("redacts tokens and truncates base64", () => {
    const out = sanitizeForLog({
      authorization: "Bearer secret",
      token: "abc",
      image: { data: "A".repeat(600) },
    }) as Record<string, unknown>;
    expect(out.authorization).toBe("[REDACTED]");
    expect(out.token).toBe("[REDACTED]");
    expect((out.image as { data: string }).data).toContain("base64");
  });

  it("parses SSE data lines in response sanitizer", () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n';
    const body = sanitizeResponseBody(200, { "content-type": "text/event-stream" }, sse);
    expect(body).toHaveProperty("sse");
  });
});
