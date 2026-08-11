/**
 * Nothing sensitive reaches a log line.
 *
 * In most applications this module is about API keys. Here it is about that
 * *and* about clinical text, which is the more dangerous of the two: a leaked
 * key can be rotated in a minute, and a therapy transcript pasted into a
 * Vercel log — where it is retained, searchable, and outside any agreement we
 * have with the practice — cannot be taken back.
 *
 * The rule this file exists to enforce: **error paths never carry note text.**
 * Log the submission id, log the state it was in, log what went wrong. The
 * words the client said stay in the database.
 */

const SECRET_PATTERNS: RegExp[] = [
  // Bearer tokens and JWTs.
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9._-]{20,}/g,
  // Common key shapes: sk-…, re_…, sb_…, supabase service keys.
  /\b(sk|re|rk|sb)[-_][A-Za-z0-9._-]{16,}/g,
  // Anything that looks like a connection string with a password in it.
  /\b(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi,
];

const KEYISH = /(key|token|secret|password|authorization|cookie|dsn|url)/i;

/** Fields whose *value* is clinical material and must never be logged at all. */
const CLINICAL_FIELDS =
  /^(rawText|normalizedText|verifiedText|ocrText|body|fields|ocrBlocks|detail|statusReason|label)$/;

/** Masks secrets inside a free-text string. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix: string | undefined) =>
      prefix ? `${prefix}[redacted]` : "[redacted]"
    );
  }
  return out;
}

/**
 * Deep-redacts an object for logging: secrets masked, clinical fields replaced
 * by a length marker.
 *
 * The length is kept deliberately. "rawText was 0 characters" is the single
 * most useful thing to know when a submission arrives empty, and it reveals
 * nothing about anybody.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactForLog(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (CLINICAL_FIELDS.test(key)) {
      out[key] = typeof val === "string" ? `[${val.length} chars withheld]` : "[withheld]";
    } else if (KEYISH.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = redactForLog(val, depth + 1);
    }
  }
  return out;
}

/**
 * The only console call the server code should make on an error path.
 * Keeps the shape consistent and guarantees the redaction actually happened.
 */
export function logSafe(scope: string, message: string, context?: unknown): void {
  const suffix = context === undefined ? "" : ` ${JSON.stringify(redactForLog(context))}`;
  console.error(`[${scope}] ${redactSecrets(message)}${suffix}`);
}
