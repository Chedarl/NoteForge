import "server-only";

import { createHash } from "crypto";

/**
 * In-memory fixed-window rate limiting.
 *
 * Honest about what it is: per-instance, and a serverless deployment has more
 * than one instance, so a determined attacker gets N times the allowance. It is
 * still worth having — it stops the accidental cases that actually happen here
 * (a retry loop hammering the upload minting route, a mistyped password
 * repeated by a script) at zero cost and with no Redis to pay for on a free
 * tier. Swap the backing store for Upstash when the practice count justifies it;
 * the call sites do not change.
 *
 * The key is **hashed with a salt** before it is stored, so a heap dump or a log
 * line never contains a bare IP address.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

function keyOf(raw: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? "noteforge-dev-salt";
  return createHash("sha256").update(`${salt}:${raw}`).digest("hex").slice(0, 32);
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  identifier: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  const key = keyOf(identifier);
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);

  // Opportunistic sweep — the map is small and this keeps it that way without a
  // timer that would keep a serverless instance alive.
  if (windows.size > 5000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }

  return {
    ok: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds,
  };
}

export function limitMessage(result: RateLimitResult): string {
  return `Too many requests. Try again in ${result.retryAfterSeconds}s.`;
}

/** Best-effort client identity for rate limiting. */
export function requestIdentifier(request: Request, fallback = "anon"): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || fallback;
}
