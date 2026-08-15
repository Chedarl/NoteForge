import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Reading the review queue.
 *
 * ## Why this is not in `review.ts`
 *
 * `review.ts` carries `"use server"`, which makes **every** export in it a
 * callable endpoint — Next mints an action id for each one and will invoke it
 * from any POST that quotes the id. These two functions take `reviewerId` and
 * `practiceId` as arguments and trust them, because their caller is a server
 * component that has already established who is asking. Exported from a
 * `"use server"` module, that same trust becomes "hand me any two ids and I
 * will return the submissions", across practices.
 *
 * So the split is not tidiness. `server-only` throws at build time if this
 * module is ever pulled into a client bundle, and nothing here is reachable
 * over the wire. The two functions that *are* endpoints live next door and each
 * begins with `requireRole`.
 */

/** Everything waiting on this clinician, oldest first — the queue they work. */
export async function pendingReviews(reviewerId: string, practiceId: string) {
  return prisma.submission.findMany({
    where: {
      practiceId,
      reviewerId,
      state: "AWAITING_REVIEW",
      reviewedAt: null,
    },
    orderBy: { encounterDate: "asc" },
    include: {
      client: {
        select: {
          id: true,
          clientCode: true,
          status: true,
          givenNameEnc: true,
          familyInitial: true,
          initials: true,
          birthYear: true,
        },
      },
      submittedBy: { select: { fullName: true, discipline: true } },
    },
  });
}

/**
 * Just the number, for the badge in the header.
 *
 * A `count` rather than `pendingReviews(...).length`: this runs on every page
 * load of the whole portal, and pulling the rows plus two joins to discard them
 * would put a client-identity decrypt behind every navigation.
 */
export async function countPendingReviews(
  reviewerId: string,
  practiceId: string
): Promise<number> {
  return prisma.submission.count({
    where: { practiceId, reviewerId, state: "AWAITING_REVIEW", reviewedAt: null },
  });
}

/** The two things a clinician can do with an update waiting on them. */
export type ReviewDecision = "approve" | "return";

export interface ReviewOutcome {
  ok: boolean;
  /** The client's code, for the audit row the caller writes. */
  clientCode?: string;
  error?: string;
}

/**
 * Applies a decision to one update.
 *
 * Takes the reviewer's id rather than reading the session, so the transition
 * can be exercised against a real database without a request context — and, as
 * with the queries above, so the whole thing is unreachable over the wire. The
 * server action next door does `requireRole` and passes what it found.
 *
 * ## The states, and why they are these
 *
 * **approve → QUEUED.** Not straight to a note. It joins the documentation
 * queue exactly like a clinician's own submission, so everything downstream —
 * duplicate flags, the SLA clock, sign-off — treats it identically. The review
 * step gates entry to the pipeline; it does not create a second pipeline.
 *
 * **return → SUPERSEDED.** Not a delete, and deliberately not `BLOCKED`.
 * The worker wrote an account of a real visit; destroying it would lose the
 * only record that the visit happened. `BLOCKED` would be a different lie —
 * that state means the status guardrail refused the client at the door, and
 * folding "a clinician disagreed" into it would corrupt the block-rate figure
 * the dashboard reports as the guardrail's own scoreboard.
 *
 * Scoped to `reviewerId` as well as `practiceId`: another clinician's queue is
 * a not-found here, not a refusal, because an error distinguishing "not yours"
 * from "does not exist" confirms the row exists.
 */
export async function applyReviewDecision(input: {
  submissionId: string;
  reviewerId: string;
  practiceId: string;
  decision: ReviewDecision;
  note: string;
}): Promise<ReviewOutcome> {
  if (input.decision === "return" && !input.note) {
    return { ok: false, error: "Say why you are sending it back — the worker will see this." };
  }

  const submission = await prisma.submission.findFirst({
    where: {
      id: input.submissionId,
      practiceId: input.practiceId,
      reviewerId: input.reviewerId,
      state: "AWAITING_REVIEW",
    },
    include: { client: { select: { clientCode: true } } },
  });
  if (!submission) return { ok: false, error: "That update is not waiting for you." };

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      state: input.decision === "approve" ? "QUEUED" : "SUPERSEDED",
      reviewedAt: new Date(),
      // The clinician's own words, kept in their own column rather than
      // appended to the worker's account — the export has to be able to show
      // who said which, and merged text never can.
      reviewNote: input.note || null,
    },
  });

  return { ok: true, clientCode: submission.client.clientCode };
}
