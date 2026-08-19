import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { columnKey } from "@/lib/crypto/key";

/**
 * Column encryption for clinical narrative.
 *
 * ## Why this is separate from `field.ts`
 *
 * `field.ts` protects a client's first name: one short value, absent more often
 * than not, where failing to decrypt is survivable because every screen falls
 * back to the client code. This protects the note itself — the thing the whole
 * product exists to move around — where the rules are different in three ways
 * that matter, so the functions are different rather than overloaded.
 *
 * ## What was wrong before
 *
 * `SECURITY.md` called this the largest remaining gap and said it was blocked
 * because the duplicate detector searches the note text. **It does not.**
 * `detectDuplicates` picks its candidates by `clientId` and an encounter-date
 * window — indexed columns, no text — takes at most eight rows, and tokenises in
 * memory. No query in the codebase ever read `normalizedText`, and the pg_trgm
 * GIN index over it was never used by anything. Encryption therefore costs eight
 * decryptions per submission, which is nothing, and the index is dropped rather
 * than worked around.
 *
 * Until now a leaked database password, a misconfigured backup or a support
 * engineer with production access read every clinical narrative in plaintext.
 * Supabase's at-rest encryption is volume-level and protects against none of
 * that.
 *
 * ## The three rules
 *
 * **1. Legacy plaintext must keep working.** Every row written before this
 * change holds plaintext, and there is no moment when they all become ciphertext
 * at once — `scripts/encrypt-existing-text.ts` converts them, and until it has
 * run (and for anything written by an older deployment mid-rollout) reads have
 * to cope with both. `openText` returns anything that is not an envelope
 * unchanged. That is the compatibility path and removing it would blank every
 * historical note.
 *
 * **2. A failed decryption returns null, never the ciphertext.** For a name,
 * showing the client code instead is fine. For a note, handing a note writer a
 * page of base64 would be worse than handing them nothing — they would not know
 * it was a failure, and it would reach a PDF, a WhatsApp link and an export.
 * Null is what every reader already handles, because a submission may genuinely
 * have no text.
 *
 * **3. The envelope prefix is distinctive on purpose.** `field.ts` uses `v1:`,
 * which is short enough that a note could plausibly begin with it. Clinical
 * prose is arbitrary text — it contains colons, base64-looking tokens and
 * whatever a clinician pasted — so the marker here is `nfenc1:`, which will not
 * occur by accident. A false positive would mean treating a real note as a
 * corrupt envelope and returning null: silent data loss, in the one column where
 * that is unacceptable.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the GCM standard
const PREFIX = "nfenc1";

/** True when a stored value is one of ours rather than legacy plaintext. */
export function isSealed(stored: string): boolean {
  return stored.startsWith(`${PREFIX}:`) && stored.split(":").length === 4;
}

/**
 * Encrypts clinical text. Returns `nfenc1:<iv>:<tag>:<ciphertext>`, all base64.
 *
 * Empty input is returned as an empty string rather than an envelope: there is
 * nothing to protect, `Submission.rawTextEnc` is non-nullable with a `""`
 * default, and an envelope around nothing is bytes that also tell an observer a
 * row exists with no text — which the row length would reveal anyway.
 *
 * Throws when no key is configured, exactly as `encryptField` does. Silently
 * writing a clinical narrative in plaintext because an environment variable was
 * missing is the failure this module exists to prevent, and it would be
 * invisible until it mattered.
 */
export function sealText(plaintext: string | null | undefined): string {
  const value = plaintext ?? "";
  if (!value) return "";

  const key = columnKey();
  if (!key) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY is not configured. Clinical text cannot be stored without it."
    );
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
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
 * Decrypts clinical text, passing legacy plaintext through unchanged.
 *
 * Never throws. See rules 1 and 2 above for why the two failure directions
 * differ: not-an-envelope means "written before this change" and is returned
 * as-is; a broken envelope means the key is wrong or the row was tampered with,
 * and returns null rather than something that looks like text.
 */
export function openText(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (!stored) return "";
  if (!isSealed(stored)) return stored;

  const key = columnKey();
  // An envelope with no key to open it is not plaintext and must not be handed
  // back as though it were.
  if (!key) return null;

  const parts = stored.split(":");
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Includes the authentication failure, which is the one worth noticing and
    // is still not worth logging: a log line naming a submission whose text
    // would not decrypt is itself a small disclosure, and rule 6 keeps note
    // text and its surroundings out of logs.
    return null;
  }
}

/**
 * A sealed JSON column: `{ nfenc: "<envelope>" }`.
 *
 * `Submission.fieldsEnc` and `Note.bodyEnc` are `Json`, and the answers inside
 * them *are* the clinical content — `rawTextEnc` is derived from them, so
 * encrypting only the derived copy would protect nothing. The whole object is
 * serialised and sealed as one value rather than per-key, because the keys are
 * template field ids and leaking which questions were answered is itself
 * informative ("this encounter recorded a suicidal-risk level").
 *
 * A wrapper object rather than a bare string so the column stays valid JSON and
 * so the legacy shape — a plain object of answers — is distinguishable at a
 * glance, by code and by a person reading a row.
 */
export interface SealedJson {
  nfenc: string;
}

export function sealJson(value: unknown): SealedJson {
  return { nfenc: sealText(JSON.stringify(value ?? {})) };
}

/** True for a value written by `sealJson`. */
export function isSealedJson(stored: unknown): stored is SealedJson {
  return (
    typeof stored === "object" &&
    stored !== null &&
    !Array.isArray(stored) &&
    typeof (stored as { nfenc?: unknown }).nfenc === "string"
  );
}

/**
 * Reads a sealed JSON column, passing a legacy plain object through.
 *
 * Returns `{}` rather than null when an envelope will not open, for the same
 * reason `openText` returns null: every caller already handles "this submission
 * recorded nothing", and none of them handle a string where an object belongs.
 */
export function openJson<T = Record<string, unknown>>(stored: unknown): T {
  if (!isSealedJson(stored)) return ((stored ?? {}) as T);
  const text = openText(stored.nfenc);
  if (text === null) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
