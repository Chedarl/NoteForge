import "server-only";

import { prisma } from "@/lib/prisma";
import { tokenize } from "@/lib/dedupe/normalize";
import { openText, sealText } from "@/lib/crypto/text";
import {
  compareTokens,
  DATE_PROXIMITY_DAYS,
  NEAR_DUPLICATE_THRESHOLD,
  OBVIOUS_DUPLICATE_THRESHOLD,
} from "@/lib/dedupe/similarity";
import { classifyPair } from "@/lib/ai/classify";
import { kimiConfigured } from "@/lib/ai/kimi";
import type { FlagKind, Submission } from "@prisma/client";

/**
 * "Have we already been given this?"
 *
 * Four layers, cheapest first, each one only running on what the previous one
 * could not settle. The ordering is the design: the exact-hash check settles the
 * commonest real case (a therapist resubmitting because they were not sure the
 * first one went through) for the price of one index lookup, and the expensive
 * model call runs only on the small remainder where a human genuinely needs
 * help deciding.
 *
 *   1. Exact hash match, same client            → DUPLICATE, certain
 *   2. Candidate set: same client, ±3 days      → nothing else is compared
 *   3. Token overlap over that set              → NEAR_DUPLICATE above threshold
 *   4. One model call on the best pair          → may upgrade it to CONFLICT
 *
 * ## The rule that makes this safe to run automatically
 *
 * **It never deletes, merges or supersedes anything.** Every layer's output is a
 * `SubmissionFlag` in state OPEN, which is a queue item for a person. That is
 * not timidity — an automatic merge that is wrong destroys a record of a real
 * session that a real clinician wrote, and there is no undo for a session
 * nobody remembers happened. Flagging is reversible; merging is not.
 *
 * ## Why the candidate set is narrow
 *
 * Only submissions for the *same client* within a few days are ever compared.
 * Two different clients producing similar text is not a duplicate, it is two
 * people having a similar week, and comparing across clients would be both
 * useless and a small privacy violation in its own right.
 */

export interface DetectionOutcome {
  flags: { kind: FlagKind; relatedSubmissionId: string; score: number; detail: string }[];
}

type Candidate = Pick<
  Submission,
  "id" | "normalizedTextEnc" | "rawTextEnc" | "encounterDate" | "contentHash" | "createdAt"
>;

export async function detectDuplicates(submission: Submission): Promise<DetectionOutcome> {
  const windowStart = new Date(submission.encounterDate);
  windowStart.setDate(windowStart.getDate() - DATE_PROXIMITY_DAYS);
  const windowEnd = new Date(submission.encounterDate);
  windowEnd.setDate(windowEnd.getDate() + DATE_PROXIMITY_DAYS);

  const candidates: Candidate[] = await prisma.submission.findMany({
    where: {
      clientId: submission.clientId,
      id: { not: submission.id },
      // A submission already resolved as superseded is not a fresh duplicate;
      // flagging against it would just re-raise a question somebody answered.
      state: { notIn: ["SUPERSEDED", "BLOCKED"] },
      encounterDate: { gte: windowStart, lte: windowEnd },
    },
    select: {
      id: true,
      normalizedTextEnc: true,
      rawTextEnc: true,
      encounterDate: true,
      contentHash: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    // More than a handful of submissions for one client in a six-day window is
    // itself unusual; comparing the most recent few is enough and bounds cost.
    take: 8,
  });

  if (candidates.length === 0) return { flags: [] };

  // ── Layer 1: certainty is cheap ──────────────────────────────────────────
  const exact = candidates.find((c) => c.contentHash === submission.contentHash);
  if (exact) {
    return {
      flags: [
        {
          kind: "DUPLICATE",
          relatedSubmissionId: exact.id,
          score: 1,
          detail:
            "Identical content to an earlier submission for this client. Almost certainly sent twice.",
        },
      ],
    };
  }

  // ── Layers 2–3: token overlap over the candidate set ─────────────────────
  //
  // Decrypted here, in memory, and this is the whole reason encrypting the note
  // columns turned out to be tractable. `SECURITY.md` recorded this as blocked
  // because "the duplicate detector searches the text" — it never did. The
  // candidate query above filters on `clientId`, `state` and `encounterDate`,
  // all indexed, and takes at most eight rows. Nothing is searched; eight values
  // are opened and compared. That is microseconds, once per submission.
  const subjectTokens = tokenize(openText(submission.rawTextEnc) ?? "");
  if (subjectTokens.length === 0) return { flags: [] };

  const scored = candidates
    .map((candidate) => ({
      candidate,
      comparison: compareTokens(
        subjectTokens,
        tokenize(openText(candidate.rawTextEnc) ?? "")
      ),
    }))
    .filter((s) => s.comparison.score >= NEAR_DUPLICATE_THRESHOLD)
    .sort((a, b) => b.comparison.score - a.comparison.score);

  if (scored.length === 0) return { flags: [] };

  const best = scored[0];
  const pctScore = Math.round(best.comparison.score * 100);

  // ── Layer 4: ask the model only when a human would genuinely benefit ──────
  //
  // Skipped when the overlap is overwhelming — at 88%+ a person just needs to
  // confirm it, and a model call adds latency and cost to a decision that is
  // already made. Skipped entirely when no key is configured, in which case the
  // flag still exists and still says something useful.
  const worthClassifying =
    kimiConfigured() && best.comparison.score < OBVIOUS_DUPLICATE_THRESHOLD;

  if (worthClassifying) {
    /*
     * The one place decrypted note text leaves this process.
     *
     * Worth being explicit about now that the column is encrypted: layers 1–3
     * are entirely local, and only this call — on the single best candidate
     * pair, above a threshold, and only when a key is configured — sends
     * clinical text to a model vendor. `AI_DISABLED=1` removes it; see
     * `docs/BAA.md`.
     */
    const verdict = await classifyPair(
      openText(best.candidate.rawTextEnc) ?? "",
      openText(submission.rawTextEnc) ?? ""
    );
    if (verdict) {
      if (verdict.verdict === "unrelated") {
        // The model saw the two documents and says the overlap is coincidence.
        // Trusting it *to suppress* a flag is the one place it gets to reduce
        // work, and it is safe in the direction that matters: the worst case is
        // a duplicate reaching the queue, which is exactly what happens today.
        return { flags: [] };
      }
      const kind: FlagKind =
        verdict.verdict === "contradiction" ? "CONFLICT" : "NEAR_DUPLICATE";
      return {
        flags: [
          {
            kind,
            relatedSubmissionId: best.candidate.id,
            score: best.comparison.score,
            detail:
              verdict.verdict === "contradiction"
                ? `Possible contradiction${verdict.conflictField ? ` (${verdict.conflictField})` : ""}: ${verdict.summary}`
                : `${pctScore}% overlap. ${verdict.summary}`,
          },
        ],
      };
    }
  }

  return {
    flags: [
      {
        kind: "NEAR_DUPLICATE",
        relatedSubmissionId: best.candidate.id,
        score: best.comparison.score,
        detail: `${pctScore}% of the meaningful terms also appear in an earlier submission for this client${
          best.comparison.newTerms.length
            ? `. New here: ${best.comparison.newTerms.slice(0, 6).join(", ")}`
            : ""
        }.`,
      },
    ],
  };
}

/** Persists the outcome. Separate from detection so detection stays testable. */
export async function persistFlags(
  submissionId: string,
  outcome: DetectionOutcome
): Promise<void> {
  if (outcome.flags.length === 0) return;
  /*
   * `detailEnc`, and the compiler will not tell you if this is wrong.
   *
   * TypeScript's excess-property check does not fire on an object literal
   * inside a `.map()`, so when the column was renamed this kept saying `detail`
   * and compiled perfectly — silently dropping the explanation from every
   * duplicate and contradiction flag. The queue would have filled with flags
   * that said nothing about why they were raised, with lint, typecheck and
   * build all green. Found by reading the file, not by a tool.
   *
   * The detail is sealed because it is clinical narrative: the classifier
   * writes summaries like "the earlier submission records suicidal ideation
   * denied on direct questioning", and the near-duplicate wording lists the
   * clinical terms that are new.
   */
  await prisma.submissionFlag.createMany({
    data: outcome.flags.map((flag) => ({
      submissionId,
      relatedSubmissionId: flag.relatedSubmissionId,
      kind: flag.kind,
      score: flag.score,
      detailEnc: sealText(flag.detail),
    })),
  });
}
