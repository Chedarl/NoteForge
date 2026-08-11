import "server-only";

import { z } from "zod";
import { kimiJson, kimiConfigured, kimiModel } from "@/lib/ai/kimi";
import { CONFIDENCE_GATE } from "@/lib/ai/confidence";

/**
 * Handwriting OCR, behind an interface.
 *
 * The interface is the point. Kimi K3 is the default because you already have
 * an account and it reads handwriting natively, but the honest position is that
 * **no free-tier model provider will sign a Business Associate Agreement**, and
 * the day this platform holds identified clinical material is the day the
 * reader has to be swapped for one that will. If that swap means rewriting the
 * verification workspace, it will not happen. So it costs one file:
 * `readHandwriting` is the only thing the rest of the codebase knows about.
 *
 * ## What comes back, and why it is blocks rather than a string
 *
 * A single confidence number for a whole page is useless. Handwriting is not
 * uniformly bad — the heading is usually clean and the bit written at speed at
 * the end of the session is not, and that last bit is disproportionately where
 * the risk information lives. Per-block confidence is what lets the verification
 * UI shade the paragraph a human must actually read, instead of asking them to
 * re-read a page they would have skimmed.
 *
 * ## What this deliberately does not do
 *
 * It does not correct, tidy, complete or interpret. A word that cannot be read
 * comes back as `[?]` rather than as the model's best guess at what a therapist
 * probably meant, because a plausible invention in a clinical record is far
 * more dangerous than a visible gap — a gap gets checked, an invention gets
 * signed.
 */

export interface OcrBlock {
  text: string;
  /** 0–1 self-reported legibility. Treated as a hint, never as a guarantee. */
  confidence: number;
}

export interface OcrResult {
  blocks: OcrBlock[];
  text: string;
  /** The weakest block on the page — what `CONFIDENCE_GATE` is applied to. */
  minConfidence: number;
  /** e.g. "kimi:kimi-k3". Recorded so an old transcript can be explained later. */
  provider: string;
}

/**
 * Re-exported from `confidence.ts`, which carries the reasoning behind the
 * number. It lives there rather than here because the verification workspace
 * runs in the browser and must shade blocks against the same threshold this
 * server-only module enforces.
 */
export { CONFIDENCE_GATE } from "@/lib/ai/confidence";

const blockSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
});
const responseSchema = z.object({ blocks: z.array(blockSchema) });

const SYSTEM = `You transcribe photographs of handwritten clinical session notes.

Rules:
- Transcribe exactly what is written. Preserve the writer's own wording, abbreviations, and line breaks between paragraphs.
- Never correct spelling, expand an abbreviation, complete an unfinished sentence, or infer anything that is not on the page.
- Where a word is genuinely illegible, write [?] in its place. Where a number is illegible, write [?] — never guess a digit.
- Split the page into blocks at natural paragraph or section boundaries.
- Give each block an honest confidence between 0 and 1 reflecting how legible that specific block is. Do not inflate it.
- Return only the JSON object.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["blocks"],
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "confidence"],
        properties: {
          text: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
};

export function readerConfigured(): boolean {
  return kimiConfigured();
}

/**
 * Reads one page image. Returns `null` when there is no reader configured or
 * the call fails — the page then arrives in the workspace with an empty
 * transcript box and gets typed, which is exactly today's process.
 */
export async function readHandwriting(
  imageDataUri: string,
  scope = "ocr"
): Promise<OcrResult | null> {
  const raw = await kimiJson<unknown>({
    system: SYSTEM,
    user: "Transcribe this page of handwritten clinical notes.",
    imageDataUri,
    schema: SCHEMA,
    schemaName: "handwriting_transcription",
    maxTokens: 3000,
    scope,
  });
  if (!raw) return null;

  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.blocks.length === 0) return null;

  const blocks = parsed.data.blocks.filter((b) => b.text.trim().length > 0);
  if (blocks.length === 0) return null;

  return {
    blocks,
    text: blocks.map((b) => b.text.trim()).join("\n\n"),
    minConfidence: Math.min(...blocks.map((b) => b.confidence)),
    provider: `kimi:${kimiModel()}`,
  };
}

/** True when a page still needs a human's eyes before it can be queued. */
export function needsHumanReview(result: OcrResult | null): boolean {
  return result === null || result.minConfidence < CONFIDENCE_GATE;
}
