import "server-only";

import { z } from "zod";
import { kimiJson } from "@/lib/ai/kimi";

/**
 * Given two submissions that token overlap says are similar, what *kind* of
 * similar are they?
 *
 * Token overlap can tell you two documents share vocabulary. It cannot tell you
 * that one says "denies suicidal ideation" and the other says "reports passive
 * SI" — which share almost every word and are the single most important thing
 * in this product to notice. That distinction is what this call exists for, and
 * it is the only place a model looks at two notes at once.
 *
 * It is a **suggestion**. The result becomes a flag with a sentence attached;
 * a person opens both documents and decides. Nothing here merges, supersedes or
 * deletes anything.
 */

export type PairVerdict = "duplicate" | "update" | "contradiction" | "unrelated";

export interface PairClassification {
  verdict: PairVerdict;
  /** One sentence a human can act on without opening both documents. */
  summary: string;
  /** Which aspect conflicts, when the verdict is a contradiction. */
  conflictField?: string;
}

const schema = z.object({
  verdict: z.enum(["duplicate", "update", "contradiction", "unrelated"]),
  summary: z.string().max(300),
  conflictField: z.string().max(80).optional(),
});

const SYSTEM = `You compare two clinical session notes about the same client and classify their relationship.

Verdicts:
- "duplicate": the same encounter recorded twice, with no new clinical information.
- "update": the second covers the same encounter but adds or revises information.
- "contradiction": they make claims that cannot both be true — conflicting risk assessment, conflicting attendance, conflicting medication or dose, conflicting goals or plan.
- "unrelated": different encounters that merely share vocabulary.

Rules:
- Prefer "contradiction" over "duplicate" whenever any clinically material statement disagrees, even if most of the text matches. A missed contradiction is far more costly than a false one.
- The summary must state the specific basis for the verdict in one sentence. Never restate the notes.
- Do not diagnose, do not offer clinical advice, do not judge quality of care.
- Return only the JSON object.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary"],
  properties: {
    verdict: { type: "string", enum: ["duplicate", "update", "contradiction", "unrelated"] },
    summary: { type: "string" },
    conflictField: { type: "string" },
  },
};

/**
 * Note text does leave the database on this call — there is no way to compare
 * two documents without showing them to the thing doing the comparing. Two
 * things bound the exposure: the identifiers are already minimised (the model
 * receives initials and a code, never a name), and this runs only for pairs
 * that already crossed the similarity threshold, not for every submission.
 */
export async function classifyPair(
  earlierText: string,
  laterText: string
): Promise<PairClassification | null> {
  const raw = await kimiJson<unknown>({
    system: SYSTEM,
    user: [
      "EARLIER SUBMISSION:",
      earlierText.slice(0, 6000),
      "",
      "LATER SUBMISSION:",
      laterText.slice(0, 6000),
    ].join("\n"),
    schema: SCHEMA,
    schemaName: "submission_pair_classification",
    maxTokens: 600,
    scope: "dedupe.classify",
  });
  if (!raw) return null;

  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
