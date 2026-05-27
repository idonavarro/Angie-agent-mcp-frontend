import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { runLayoutScan } from "../src/browser/run-scan.js";

const FIXTURE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body><div data-id="abc123" style="width:1400px;height:80px;background:#ccc;">wide</div></body></html>`;

describe("layout_scan screenshot", () => {
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
        if (addr && typeof addr === "object") port = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns PNG base64 when include_screenshot is true", async () => {
    const url = `http://127.0.0.1:${port}/`;
    const result = await runLayoutScan({
      url,
      viewportWidth: 375,
      viewportHeight: 812,
      allowedHosts: ["127.0.0.1"],
      allowlistOptions: { allowInsecureHttp: true, allowPrivateUrls: true },
      includeScreenshot: true,
      screenshotMode: "viewport",
    });

    expect(result.screenshot?.base64.length).toBeGreaterThan(100);
    expect(result.screenshot?.mimeType).toBe("image/png");
    expect(result.screenshot_meta?.included_in_response).toBe(true);
  }, 60_000);
});
