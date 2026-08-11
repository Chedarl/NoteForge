/**
 * The OCR confidence gate, in a file the browser can import.
 *
 * `reader.ts` is `server-only` — it holds an API key and makes the call — but
 * the verification workspace runs in the browser and has to shade blocks using
 * the same threshold the server applies. A second, drifting copy of this number
 * would mean the UI telling a transcriber a page is fine while the server still
 * considers it unverified.
 *
 * Set high, at 0.85. The cost of waving through a misread number in a clinical
 * note is not symmetrical with the cost of a transcriber reading one extra
 * paragraph, so the threshold leans towards making people look.
 */
export const CONFIDENCE_GATE = 0.85;

/** Below this, a block is shaded strongly rather than merely marked. */
export const CONFIDENCE_POOR = 0.7;
