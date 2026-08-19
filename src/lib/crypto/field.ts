import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { columnKey } from "@/lib/crypto/key";

/**
 * Column-level encryption for the one genuinely identifying field this system
 * holds: a client's first name.
 *
 * ## Why this exists at all
 *
 * Everything else in the schema is deliberately non-identifying — a practice
 * code, initials, a birth year. A first name is different in kind, and it is
 * here because a transcriber has to be certain which person a note belongs to
 * and "A.M." across a caseload of two hundred is not certainty.
 *
 * Supabase encrypts the disk. That protects against somebody stealing the
 * physical volume and against essentially nothing else. It does not protect
 * against a leaked database password, a misconfigured backup, a support
 * engineer with production access, or a SQL injection that gets as far as
 * `SELECT * FROM "Client"`. Encrypting the column does, because the key lives
 * in the application environment and never in the database.
 *
 * ## AES-256-GCM, and why not something simpler
 *
 * GCM is authenticated: it fails loudly if the ciphertext has been altered,
 * rather than quietly returning different plaintext. In a clinical record,
 * silently decrypting to the *wrong name* is worse than failing, because a
 * wrong name is indistinguishable from a right one to the person reading it.
 *
 * A random IV per value means the same name encrypts differently every time —
 * so nobody can tell from the ciphertext that two clients share a first name,
 * which is exactly the kind of inference a column of deterministic ciphertext
 * leaks.
 *
 * ## The consequence, stated plainly
 *
 * Encrypted columns cannot be searched or sorted by the database. That is a
 * real cost and it is accepted: names are for *confirming* a client, not for
 * finding one. Search is by client code, which is not sensitive and is indexed.
 *
 * ## Losing the key
 *
 * If `FIELD_ENCRYPTION_KEY` is lost, the names are gone. Nothing else is —
 * every code, note, submission and audit row is unaffected, because nothing
 * depends on the name. That is by design: the encrypted field is a convenience
 * layered on top of a system that works without it.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the GCM standard
const PREFIX = "v1";

/**
 * The key, now shared with `text.ts`.
 *
 * It moved to `crypto/key.ts` when clinical narrative started being encrypted
 * with the same secret: two copies of a key derivation is how one of them
 * quietly stops matching the other, and the symptom would be a whole column
 * that no longer decrypts.
 */
const key = columnKey;

export function fieldCryptoConfigured(): boolean {
  return key() !== null;
}

/**
 * Encrypts a value. Returns `v1:<iv>:<tag>:<ciphertext>`, all base64.
 *
 * Returns null for empty input, so an absent name stays absent rather than
 * becoming an encrypted empty string that looks like data.
 *
 * Throws when no key is configured. Deliberately: silently storing a name in
 * plaintext because an environment variable was forgotten is precisely the
 * failure this module exists to prevent, and it would be invisible until a
 * breach made it obvious.
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  const value = plaintext?.trim();
  if (!value) return null;

  const k = key();
  if (!k) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY is not configured. Client names cannot be stored without it."
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, k, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypts a value, or returns null if it cannot.
 *
 * Never throws. A name that will not decrypt — rotated key, corrupted row,
 * tampered ciphertext — must not take down the page that was going to display
 * it. The caller falls back to the client code, which is always present and
 * always sufficient to identify the record.
 */
export function decryptField(stored: string | null | undefined): string | null {
  if (!stored) return null;

  const k = key();
  if (!k) return null;

  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;

  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");

    const decipher = createDecipheriv(ALGORITHM, k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Includes the authentication failure case, which is the one worth noticing
    // — but not worth logging, because a log line saying "a name failed to
    // decrypt" alongside a client id is itself a small disclosure.
    return null;
  }
}
