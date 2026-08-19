import "server-only";

import { createHash } from "crypto";

/**
 * The one key, derived once.
 *
 * Both column-encryption modules — `field.ts` for a client's first name and
 * `text.ts` for clinical narrative — use the same `FIELD_ENCRYPTION_KEY`, and
 * the derivation lives here so there is exactly one of it. Two copies of a key
 * derivation is how one of them quietly stops matching the other after a
 * well-meaning change, and the symptom would be an entire column that no longer
 * decrypts.
 *
 * SHA-256 of the environment value rather than a KDF with a work factor: this is
 * a high-entropy random secret from `openssl rand`, not a password, so
 * stretching buys nothing and would cost a hash on every row rendered.
 *
 * The variable keeps its original name even though it now protects more than
 * one field. Renaming it would be a breaking change for every existing
 * deployment, and **the key must never be regenerated** — every stored client
 * name and, after this change, every stored note is encrypted with it.
 */
export function columnKey(): Buffer | null {
  const secret = process.env.FIELD_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) return null;
  return createHash("sha256").update(secret).digest();
}

export function columnCryptoConfigured(): boolean {
  return columnKey() !== null;
}
