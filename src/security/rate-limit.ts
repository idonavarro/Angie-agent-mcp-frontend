import { extractAuthToken } from "./auth.js";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();

  check(token: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
    const now = Date.now();
    const entry = this.entries.get(token);

    if (!entry || now >= entry.resetAt) {
      this.entries.set(token, { count: 1, resetAt: now + WINDOW_MS });
      return { allowed: true };
    }

    if (entry.count >= MAX_REQUESTS) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, retryAfterSec };
    }

    entry.count += 1;
    return { allowed: true };
  }

  /** Visible for testing */
  reset(): void {
    this.entries.clear();
  }
}

export const rateLimiter = new RateLimiter();

export function createRateLimitHook(limiter: RateLimiter) {
  return async function rateLimitHook(
    request: Pick<import("fastify").FastifyRequest, "headers" | "query">,
    reply: { code: (status: number) => { send: (body: unknown) => void } }
  ): Promise<void> {
    const token = extractAuthToken(request) ?? "anonymous";

    const result = limiter.check(token);
    if (!result.allowed) {
      reply.code(429).send({
        error: "Rate limit exceeded",
        retry_after_sec: result.retryAfterSec,
      });
    }
  };
}
