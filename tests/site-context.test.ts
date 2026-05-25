import { describe, it, expect } from "vitest";
import { resolveAllowedHosts, applySiteContext } from "../src/security/site-context.js";
import { parseLayoutScanInput } from "../src/tools/layout-scan.js";

describe("site-context", () => {
  it("resolves allowed_hosts from site_url", () => {
    const hosts = resolveAllowedHosts({ site_url: "https://www.example.com/page" });
    expect(hosts).toEqual(["www.example.com"]);
  });

  it("prefers explicit allowed_hosts over site_url", () => {
    const hosts = resolveAllowedHosts({
      site_url: "https://other.com",
      allowed_hosts: ["example.com"],
    });
    expect(hosts).toEqual(["example.com"]);
  });

  it("resolves from site_host field", () => {
    const hosts = resolveAllowedHosts({ site_host: "staging.example.com" });
    expect(hosts).toEqual(["staging.example.com"]);
  });

  it("applySiteContext injects allowed_hosts for layout_scan parse", () => {
    const parsed = parseLayoutScanInput(
      applySiteContext({
        url: "https://example.com/page",
        site_url: "https://example.com",
      })
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.allowed_hosts).toEqual(["example.com"]);
    }
  });
});
