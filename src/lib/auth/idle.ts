/**
 * Signing somebody out when they walk away.
 *
 * A clinical workstation is shared, wheeled between rooms, and left unlocked.
 * The session cookie itself is long-lived on purpose — a clinician mid-round
 * should not be thrown out because their token aged — so "how long since this
 * person last did anything" is a different question from "is this token still
 * valid", and nothing was asking it.
 *
 * Edge-safe: this file reads and writes one cookie and does arithmetic. No
 * database, no secrets, because the middleware runs here.
 *
 * ## Why the timestamp is signed
 *
 * The cookie is set by the server and read by the server, and a cookie is
 * client-controlled. Without a signature anybody could hold a session open
 * indefinitely by pinning the value — which would make the whole control
 * decorative. It is an HMAC over the minute, so a forged one does not verify
 * and is treated as "no idea when you were last here", which fails to a sign-out
 * rather than to an extension.
 *
 * Minute granularity rather than millisecond: it keeps the cookie small, and it
 * means the value only changes once a minute, so most requests do not rewrite
 * it at all.
 */

export const IDLE_COOKIE = "nf_seen";

/** Minutes of inactivity before the session is ended. */
export function idleTimeoutMinutes(): number {
  const configured = Number(process.env.SESSION_IDLE_MINUTES ?? "30");
  if (!Number.isFinite(configured)) return 30;
  // Floor of 5 so a misconfiguration cannot make the product unusable; ceiling
  // of a working day, because past that it is not a timeout, it is a cookie.
  return Math.min(720, Math.max(5, Math.floor(configured)));
}

async function sign(minute: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`idle:${minute}`)
  );
  // First 16 hex characters is plenty: this authenticates a timestamp, not a
  // credential, and the cookie rides on every request.
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function stampIdleCookie(secret: string): Promise<string> {
  const minute = String(Math.floor(Date.now() / 60_000));
  return `${minute}.${await sign(minute, secret)}`;
}

/**
 * Minutes since the stamp, or null when there is no usable one.
 *
 * Null means "cannot tell", and every caller treats that as *not yet idle* —
 * because a first request after signing in has no stamp, and throwing somebody
 * out at the moment they arrive would be worse than the risk this manages. The
 * stamp is written on that same response, so the second request has one.
 */
export async function minutesSinceSeen(
  value: string | undefined,
  secret: string
): Promise<number | null> {
  if (!value) return null;
  const [minute, mac] = value.split(".");
  if (!minute || !mac) return null;
  if (!/^\d+$/.test(minute)) return null;
  if ((await sign(minute, secret)) !== mac) return null;

  const elapsed = Date.now() / 60_000 - Number(minute);
  // A stamp from the future is a clock change or a forgery that happens to
  // verify against a rolled-back clock. Treated as unknown rather than as
  // freshness, so it can never extend a session.
  if (elapsed < -1) return null;
  return Math.max(0, elapsed);
}
