export interface AllowlistOptions {
  allowInsecureHttp: boolean;
  allowPrivateUrls: boolean;
}

export interface AllowlistError {
  code: string;
  message: string;
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

const BLOCKED_PROTOCOLS = ["file:", "data:", "javascript:"];

function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith("[") && host.endsWith("]")) return true;
  return false;
}

function isPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

/**
 * Check if hostname equals or is a subdomain of an allowed host entry.
 */
export function hostMatchesAllowlist(hostname: string, allowedHosts: string[]): boolean {
  const host = normalizeHost(hostname);
  return allowedHosts.some((entry) => {
    const allowed = normalizeHost(entry);
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

export function validateUrl(
  urlString: string,
  allowedHosts: string[],
  options: AllowlistOptions
): { ok: true; url: URL } | { ok: false; error: AllowlistError } {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, error: { code: "invalid_url", message: "Invalid URL" } };
  }

  if (BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
    return {
      ok: false,
      error: { code: "blocked_protocol", message: `Protocol ${parsed.protocol} is not allowed` },
    };
  }

  if (parsed.protocol === "http:" && !options.allowInsecureHttp) {
    return {
      ok: false,
      error: { code: "insecure_http", message: "HTTP URLs require ALLOW_INSECURE_HTTP=true" },
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      error: { code: "unsupported_protocol", message: `Protocol ${parsed.protocol} is not supported` },
    };
  }

  const hostname = parsed.hostname;

  if (isIpLiteral(hostname) && !options.allowPrivateUrls) {
    return {
      ok: false,
      error: { code: "ip_literal_blocked", message: "IP literal URLs are not allowed" },
    };
  }

  if (isPrivateHost(hostname) && !options.allowPrivateUrls) {
    return {
      ok: false,
      error: { code: "private_url_blocked", message: "Private/localhost URLs are not allowed" },
    };
  }

  if (!hostMatchesAllowlist(hostname, allowedHosts)) {
    return {
      ok: false,
      error: {
        code: "host_not_allowed",
        message: `Host ${hostname} is not in allowed_hosts`,
      },
    };
  }

  return { ok: true, url: parsed };
}

export function validateFinalUrl(
  finalUrl: string,
  allowedHosts: string[],
  options: AllowlistOptions
): { ok: true; url: URL } | { ok: false; error: AllowlistError } {
  const result = validateUrl(finalUrl, allowedHosts, options);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: "redirect_blocked",
        message: `Redirect to disallowed host: ${result.error.message}`,
      },
    };
  }
  return result;
}

/** Log-safe URL: host + pathname only (no query string). */
export function safeUrlForLog(url: URL): string {
  return `${url.hostname}${url.pathname}`;
}
