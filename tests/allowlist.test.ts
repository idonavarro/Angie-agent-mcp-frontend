import { describe, it, expect } from "vitest";
import {
  validateUrl,
  validateFinalUrl,
  hostMatchesAllowlist,
} from "../src/security/allowlist.js";

const defaultOptions = { allowInsecureHttp: false, allowPrivateUrls: false };
const privateOptions = { allowInsecureHttp: false, allowPrivateUrls: true };
const httpOptions = { allowInsecureHttp: true, allowPrivateUrls: false };

describe("hostMatchesAllowlist", () => {
  it("accepts exact host match", () => {
    expect(hostMatchesAllowlist("example.com", ["example.com"])).toBe(true);
  });

  it("accepts subdomain match", () => {
    expect(hostMatchesAllowlist("www.example.com", ["example.com"])).toBe(true);
    expect(hostMatchesAllowlist("blog.staging.example.com", ["example.com"])).toBe(true);
  });

  it("rejects unrelated host", () => {
    expect(hostMatchesAllowlist("evil.com", ["example.com"])).toBe(false);
  });

  it("rejects suffix trick (notexample.com)", () => {
    expect(hostMatchesAllowlist("notexample.com", ["example.com"])).toBe(false);
  });
});

describe("validateUrl", () => {
  it("accepts valid https URL with matching host", () => {
    const result = validateUrl("https://www.example.com/page", ["example.com"], defaultOptions);
    expect(result.ok).toBe(true);
  });

  it("rejects file protocol", () => {
    const result = validateUrl("file:///etc/passwd", ["localhost"], privateOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("blocked_protocol");
  });

  it("rejects data protocol", () => {
    const result = validateUrl("data:text/html,hello", ["example.com"], defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("blocked_protocol");
  });

  it("rejects javascript protocol", () => {
    const result = validateUrl("javascript:alert(1)", ["example.com"], defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("blocked_protocol");
  });

  it("rejects wrong host", () => {
    const result = validateUrl("https://evil.com/page", ["example.com"], defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("host_not_allowed");
  });

  it("rejects http when insecure not allowed", () => {
    const result = validateUrl("http://example.com/", ["example.com"], defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("insecure_http");
  });

  it("accepts http when ALLOW_INSECURE_HTTP", () => {
    const result = validateUrl("http://example.com/", ["example.com"], httpOptions);
    expect(result.ok).toBe(true);
  });

  it("rejects localhost without private flag", () => {
    const result = validateUrl("https://localhost/test", ["localhost"], defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("private_url_blocked");
  });

  it("accepts localhost with private flag", () => {
    const result = validateUrl("http://127.0.0.1:8080/", ["127.0.0.1"], {
      allowInsecureHttp: true,
      allowPrivateUrls: true,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects IP literal without private flag", () => {
    const result = validateUrl("https://8.8.8.8/", ["8.8.8.8"], defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ip_literal_blocked");
  });
});

describe("validateFinalUrl", () => {
  it("returns redirect_blocked for disallowed redirect host", () => {
    const result = validateFinalUrl("https://evil.com/landing", ["example.com"], defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("redirect_blocked");
  });
});
