import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "crypto";

/**
 * The code that stops a forwarded link from being a leaked note.
 *
 * WhatsApp is how this practice actually hands work over, and taking it away
 * would not make anything safer — it would move the PDF into email, or onto a
 * memory stick, or back onto paper. So the channel stays and the assumption
 * underneath it changes.
 *
 * The old assumption was that the URL is the secret. That holds while the URL
 * is only ever in the hands it was sent to, and it is exactly wrong for a
 * messenger: a chat sits in a cloud backup, on a screen somebody else can read,
 * in a group somebody was added to by mistake, and on a device that gets handed
 * to a colleague. Meta signs no business associate agreement, so none of that
 * is covered by anything.
 *
 * With a passcode the message alone is not enough. The link goes over WhatsApp
 * and the six digits go some other way — said on the phone, sent in a different
 * app, agreed in person. Whoever reads the chat has a URL that asks them a
 * question they cannot answer.
 *
 * ## Why six digits is enough
 *
 * A million combinations is nothing offline. This is not an offline problem:
 * there is no way to test a guess except by asking this server, and after five
 * wrong answers the link is finished. Five in a million, with no second run.
 * The ceiling does the work, not the length of the code.
 *
 * The lock is permanent rather than timed, because a lock that lifts after an
 * hour is a lock an attacker waits out. A locked link gets replaced, and
 * replacing one is three taps.
 *
 * ## Why the stored form is an HMAC rather than a hash
 *
 * A plain SHA-256 of six digits is a lookup table anyone builds in a second, so
 * a leaked database would give up every code at once. The HMAC key lives in the
 * environment, so the database alone is not enough. It is bound to the link's
 * own token hash as well, so one code used on two links does not store the same
 * value twice.
 */

/** Wrong answers before the link is finished. */
export const MAX_PASSCODE_ATTEMPTS = 5;

/** How long an unlocked link stays unlocked in that browser. */
export const UNLOCK_MINUTES = 30;

/**
 * Present only where the signing secret is.
 *
 * Checked rather than assumed: minting a link that *says* it is protected and
 * is not would be worse than refusing to mint one. Callers fail closed.
 */
export function passcodeAvailable(): boolean {
  return Boolean(process.env.CONFIRM_LINK_SECRET);
}

function key(): string {
  const value = process.env.CONFIRM_LINK_SECRET;
  if (!value) throw new Error("CONFIRM_LINK_SECRET is not configured");
  return value;
}

/** Six digits, uniformly drawn. `randomInt` rather than `Math.random`. */
export function generatePasscode(): string {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

/**
 * Domain-separated on purpose. The same secret signs status-confirmation links,
 * and a value produced for one job must never verify for the other.
 */
function mac(label: string, ...parts: string[]): string {
  return createHmac("sha256", key()).update([label, ...parts].join(" ")).digest("hex");
}

export function hashPasscode(tokenHash: string, passcode: string): string {
  return mac("share-passcode", tokenHash, passcode);
}

/** Constant-time, so a wrong code cannot be narrowed down by how long it took. */
export function passcodeMatches(
  tokenHash: string,
  stored: string,
  supplied: string
): boolean {
  const expected = Buffer.from(hashPasscode(tokenHash, supplied), "hex");
  const actual = Buffer.from(stored, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * The unlock proof, kept in a cookie rather than a row.
 *
 * It is derived, not stored: a value only this server can produce, checked by
 * producing it again. No session table, nothing to clean up, and a download
 * route that can verify it without a second database round trip on a path that
 * already performs an atomic claim.
 *
 * The cookie is scoped to one link's own path, so unlocking one share does not
 * unlock another that happens to be open in the same browser.
 */
export function unlockValue(tokenHash: string): string {
  return mac("share-unlock", tokenHash);
}

export function unlockMatches(tokenHash: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const expected = Buffer.from(unlockValue(tokenHash), "hex");
  const actual = Buffer.from(cookieValue, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** One cookie per link, so the name cannot be reused across shares. */
export function unlockCookieName(tokenHash: string): string {
  return `nf_share_${tokenHash.slice(0, 16)}`;
}
