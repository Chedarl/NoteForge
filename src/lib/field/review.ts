"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { applyReviewDecision, type ReviewDecision } from "@/lib/field/reviewQueue";

/**
 * A clinician reading what their field worker sent, before anybody writes a
 * note from it.
 *
 * This is the step the whole supervised-link arrangement exists for. A recovery
 * coach's account of a doorstep visit is somebody's recollection until a
 * clinician has read it and put their name to it; passing it straight to
 * documentation would mean a clinical note written from an unreviewed report,
 * with no one answerable for the difference.
 *
 * Everything in this file is a `"use server"` export, which means Next mints a
 * callable action id for each one. So this file holds *only* things that begin
 * by establishing who is asking. The queries and the transition itself live in
 * `reviewQueue.ts` behind `server-only`, where nothing can reach them but code
 * that has already done that.
 */

export interface ReviewState {
  error?: string;
  approved?: boolean;
  returned?: boolean;
}

async function decide(decision: ReviewDecision, formData: FormData): Promise<ReviewState> {
  const user = await requireRole(["OWNER", "THERAPIST", "SPECIALIST"]);

  const outcome = await applyReviewDecision({
    submissionId: String(formData.get("submissionId") ?? ""),
    reviewerId: user.id,
    practiceId: user.practiceId,
    decision,
    note: String(formData.get("reviewNote") ?? "").trim(),
  });

  if (!outcome.ok) return { error: outcome.error };

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: decision === "approve" ? "field.update.approved" : "field.update.returned",
    entityType: "submission",
    entityId: String(formData.get("submissionId") ?? ""),
    entityLabel: outcome.clientCode,
    changes: {
      state: {
        from: "AWAITING_REVIEW",
        to: decision === "approve" ? "QUEUED" : "SUPERSEDED",
      },
    },
  });

  revalidatePath("/t/review");
  // The documentation queue only changes on an approval; a returned update
  // never entered it.
  if (decision === "approve") revalidatePath("/s");

  return decision === "approve" ? { approved: true } : { returned: true };
}

/** Approves it, and only then does it become available for documentation. */
export async function approveFieldUpdate(
  _prev: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  return decide("approve", formData);
}

/** Sends it back to the worker, without throwing any of it away. */
export async function returnFieldUpdate(
  _prev: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  return decide("return", formData);
}
