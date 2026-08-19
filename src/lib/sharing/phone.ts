/**
 * Turning what somebody types into a number WhatsApp can actually open.
 *
 * The old version took the digits, prefixed a `+`, and called it E.164. That is
 * right only when the person has already typed their country code, and wrong —
 * silently, always — when they have not. A clinician typing the number the way
 * they would say it out loud produced this:
 *
 *     "0712345678"      ->  +0712345678     no country begins +0
 *     "712345678"       ->  +712345678      that is Russia
 *     "(555) 123-4567"  ->  +5551234567     a US number missing its +1
 *
 * Each of those passed validation, was stored, and opened WhatsApp on nobody.
 * Nothing failed loudly enough to notice; the send simply never arrived.
 *
 * So a calling code is now supplied explicitly by the interface, and a national
 * number without one is **refused** rather than guessed at. Guessing is what
 * caused this. A number pasted in full international form still wins, because
 * somebody who typed `+237...` has already answered the question.
 */

/** The leading `0` in a national number is a trunk prefix and is never dialled internationally. */
const TRUNK_PREFIX = /^0+/;

export type PhoneProblem =
  | "EMPTY"
  | "NO_COUNTRY_CODE"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "NO_NATIONAL_NUMBER";

export type PhoneResult = { ok: true; e164: string } | { ok: false; problem: PhoneProblem };

/** Human wording for each refusal, so the form can say what to do about it. */
export const PHONE_PROBLEM_MESSAGE: Record<PhoneProblem, string> = {
  EMPTY: "Enter a number, or leave it blank to pick the contact in WhatsApp.",
  NO_COUNTRY_CODE:
    "Choose the country code, or type the number in full international form starting with +.",
  TOO_SHORT: "That number looks too short. Check the digits after the country code.",
  TOO_LONG: "That number is longer than any real phone number.",
  NO_NATIONAL_NUMBER: "Enter the number itself, not just the country code.",
};

export function toE164(input: string, callingCode?: string): PhoneResult {
  const raw = input.trim();
  if (!raw) return { ok: false, problem: "EMPTY" };

  // `+` and the `00` international prefix both mean "the country code follows".
  const isInternational = raw.startsWith("+") || /^00\d/.test(raw);

  let digits: string;
  if (isInternational) {
    digits = raw.replace(/^\+/, "").replace(/^00/, "").replace(/\D/g, "");
  } else {
    const code = (callingCode ?? "").replace(/\D/g, "");
    if (!code) return { ok: false, problem: "NO_COUNTRY_CODE" };
    // Drop the trunk prefix: 0712345678 dialled from abroad is <code>712345678.
    const national = raw.replace(/\D/g, "").replace(TRUNK_PREFIX, "");
    if (!national) return { ok: false, problem: "NO_NATIONAL_NUMBER" };
    digits = `${code}${national}`;
  }

  if (digits.length < 8) return { ok: false, problem: "TOO_SHORT" };
  // E.164 caps the whole number, country code included, at fifteen digits.
  if (digits.length > 15) return { ok: false, problem: "TOO_LONG" };

  return { ok: true, e164: `+${digits}` };
}

/**
 * The old signature, kept for callers that only need "did it work".
 *
 * Deliberately still requires a calling code for a national number — returning
 * a plausible-looking wrong number is the behaviour being removed, not
 * preserved.
 */
export function normalizeWhatsAppNumber(value: string, callingCode?: string): string | null {
  const result = toE164(value, callingCode);
  return result.ok ? result.e164 : null;
}

/**
 * Calling codes offered in the interface.
 *
 * A short list rather than every country on earth: the form is used on a phone,
 * one-handed, between sessions, and a 200-entry select is its own kind of
 * failure. Anyone outside it can paste a full `+` number, which always wins.
 */
export const CALLING_CODES: { code: string; label: string }[] = [
  { code: "1", label: "United States / Canada (+1)" },
  { code: "44", label: "United Kingdom (+44)" },
  { code: "237", label: "Cameroon (+237)" },
  { code: "234", label: "Nigeria (+234)" },
  { code: "233", label: "Ghana (+233)" },
  { code: "254", label: "Kenya (+254)" },
  { code: "27", label: "South Africa (+27)" },
  { code: "91", label: "India (+91)" },
  { code: "63", label: "Philippines (+63)" },
  { code: "353", label: "Ireland (+353)" },
  { code: "61", label: "Australia (+61)" },
  { code: "33", label: "France (+33)" },
  { code: "49", label: "Germany (+49)" },
  { code: "32", label: "Belgium (+32)" },
  { code: "31", label: "Netherlands (+31)" },
];

/**
 * Splits a stored international number back into a code and a national part.
 *
 * The forms hold the calling code in a `<select>` and the rest in a text box.
 * A number saved earlier comes back as E.164 — `+2348012345678` — and putting
 * that whole string into the *national* box left it sitting beside a selector
 * still reading `+1`: a number displayed as belonging to two countries at once.
 * It still sent correctly, because `toE164` treats a leading `+` as
 * authoritative, so nothing failed — it just looked broken, and the moment
 * somebody tidied the `+` away it silently became a US number.
 *
 * Longest code first, because `+1` is a prefix of nothing but `+23` is a prefix
 * of `+234` and `+233`. An unrecognised country falls back to the whole number
 * in the text box, where the `+` still wins — worse-looking than a clean split,
 * and still correct, which is the right way round for a fallback.
 */
export function splitE164(stored: string | null | undefined): {
  code: string;
  national: string;
} {
  const raw = (stored ?? "").trim();
  if (!raw) return { code: "1", national: "" };
  if (!raw.startsWith("+")) return { code: "1", national: raw };

  const digits = raw.slice(1).replace(/\D/g, "");
  const byLongest = [...CALLING_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const { code } of byLongest) {
    if (digits.startsWith(code)) {
      return { code, national: digits.slice(code.length) };
    }
  }
  return { code: "1", national: raw };
}
