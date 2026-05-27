import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadScreenshot, getAgentImgToken } from "../src/browser/image-upload.js";

describe("image-upload", () => {
  const originalToken = process.env.AGENT_IMG_TOKEN;

  beforeEach(() => {
    process.env.AGENT_IMG_TOKEN = "aih_test_token";
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.AGENT_IMG_TOKEN;
    } else {
      process.env.AGENT_IMG_TOKEN = originalToken;
    }
    vi.unstubAllGlobals();
  });

  it("returns error when token is not configured", async () => {
    delete process.env.AGENT_IMG_TOKEN;
    expect(getAgentImgToken()).toBeUndefined();

    const result = await uploadScreenshot(Buffer.from("png"), "test.png");
    expect(result).toEqual({ ok: false, error: "agent_img_token_not_configured" });
  });

  it("uploads PNG bytes and returns url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ url: "https://agent-img.com/i/abc123.png" }),
      }))
    );

    const result = await uploadScreenshot(Buffer.from("fake-png"), "viewport-375.png");
    expect(result).toEqual({ ok: true, url: "https://agent-img.com/i/abc123.png" });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent-img.com/api/upload",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer aih_test_token" },
      })
    );
  });
});
