import "server-only";

import { SignJWT, jwtVerify } from "jose";

/**
 * One-click links for the status-confirmation emails.
 *
 * The whole point of the confirmation sweep is that a therapist answers it. A
 * link that opens a login screen gets ignored, the client stays stale, and we
 * are back to finding out somebody died from a note that comes back rejected.
 * So the link authenticates itself.
 *
 * What keeps that safe:
 *
 *  - it is signed, short-lived (14 days — long enough to survive a holiday,
 *    short enough that a forwarded email goes cold), and scoped to **one**
 *    confirmation id;
 *  - it can do exactly one thing: answer a status question about one client.
 *    It cannot read a note, cannot list clients, cannot reach the queue;
 *  - it carries no client identity in the URL, only the confirmation id, so a
 *    link sitting in an inbox or a proxy log discloses nothing on its own.
 */

const ISSUER = "noteforge";
const AUDIENCE = "status-confirmation";

function secret(): Uint8Array {
  const value = process.env.CONFIRM_LINK_SECRET;
  if (!value) throw new Error("CONFIRM_LINK_SECRET is not configured");
  return new TextEncoder().encode(value);
}

export async function signConfirmToken(confirmationId: string): Promise<string> {
  return new SignJWT({ cid: confirmationId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(secret());
}

/** Returns the confirmation id, or null for anything that does not verify. */
export async function readConfirmToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const cid = payload.cid;
    return typeof cid === "string" ? cid : null;
  } catch {
    return null;
  }
}
