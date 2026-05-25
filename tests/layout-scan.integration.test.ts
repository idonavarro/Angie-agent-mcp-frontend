import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { runLayoutScan } from "../src/browser/run-scan.js";

const FIXTURE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>overflow fixture</title></head>
<body><div style="width:1400px;background:#ccc;">wide</div></body></html>`;

describe("layout_scan integration", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(FIXTURE_HTML);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("detects horizontal overflow on 1400px wide element at 375px viewport", async () => {
    const url = `http://127.0.0.1:${port}/`;
    const result = await runLayoutScan({
      url,
      viewportWidth: 375,
      viewportHeight: 812,
      allowedHosts: ["127.0.0.1"],
      allowlistOptions: { allowInsecureHttp: true, allowPrivateUrls: true },
    });

    expect(result.has_horizontal_scroll).toBe(true);
    expect(result.horizontal_overflow_px).toBeGreaterThan(0);
    expect(result.offenders.length).toBeGreaterThan(0);
    expect(result.http_status).toBe(200);
  }, 60_000);
});
