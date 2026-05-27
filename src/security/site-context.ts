/** Angie site-scoped tool injection field names (when "Site-scoped tools" is ON). */
const SITE_URL_FIELDS = [
  "site_url",
  "siteUrl",
  "wordpress_site_url",
  "wordpressSiteUrl",
  "home_url",
  "homeUrl",
  "blog_url",
  "website_url",
  "angie_site_url",
  "_angie_site_url",
] as const;

const SITE_HOST_FIELDS = [
  "site_host",
  "siteHost",
  "wordpress_site_host",
  "wordpressSiteHost",
  "angie_site_host",
] as const;

function hostnameFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/**
 * Resolve allowed_hosts from Angie-injected site context when the agent
 * did not pass allowed_hosts explicitly.
 */
export function resolveAllowedHosts(args: Record<string, unknown>): string[] | null {
  if (Array.isArray(args.allowed_hosts) && args.allowed_hosts.length > 0) {
    return args.allowed_hosts.filter((h): h is string => typeof h === "string" && h.length > 0);
  }

  for (const key of SITE_HOST_FIELDS) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      return [value.replace(/^\.+/, "").toLowerCase()];
    }
  }

  for (const key of SITE_URL_FIELDS) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      const host = hostnameFromUrl(value);
      if (host) return [host];
    }
  }

  // Angie often sends only `url` (page permalink) without separate site_url injection.
  if (typeof args.url === "string" && args.url.length > 0) {
    const host = hostnameFromUrl(args.url);
    if (host) return [host];
  }

  return null;
}

/** Merge Angie site context into tool args before validation. */
export function applySiteContext(args: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(args.allowed_hosts) && args.allowed_hosts.length > 0) {
    return args;
  }

  const hosts = resolveAllowedHosts(args);
  if (!hosts) return args;

  return { ...args, allowed_hosts: hosts };
}
