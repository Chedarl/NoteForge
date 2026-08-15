"use server";

import { revalidatePath } from "next/cache";
import { resolveFieldLink, noteFieldLinkUse } from "@/lib/field/links";
import { resolveClientByName } from "@/lib/clients/resolve";
import { submitEncounter } from "@/lib/intake/submit";
import { writeAudit } from "@/lib/audit";

/**
 * A field worker's update, arriving through a link instead of a login.
 *
 * The important thing about this file is how little of it there is. It resolves
 * the token, resolves the client name, and hands the rest to `submitEncounter`
 * — which means the status guardrail, the refuse-but-record rule, duplicate
 * detection and the audit trail all apply to a worker in a car park exactly as
 * they apply to a clinician at a desk. That is rule zero in CLAUDE.md and it is
 * why this feature took a schema change rather than a new pipeline.
 */

export interface FieldUpdateState {
  error?: string;
  blocked?: string;
  success?: { clientCode: string; when: string; awaitingReview: boolean };
}

export async function submitFieldUpdate(
  _prev: FieldUpdateState,
  formData: FormData
): Promise<FieldUpdateState> {
  const token = String(formData.get("token") ?? "");
  const session = await resolveFieldLink(token);
  // One message for every reason. Telling a stranger which of "malformed",
  // "unknown", "revoked" or "suspended" applies tells them whether they have
  // found something real.
  if (!session) return { error: "This link is no longer active. Ask for a new one." };

  const name = String(formData.get("clientName") ?? "").trim();
  const update = String(formData.get("update") ?? "").trim();
  const dateRaw = String(formData.get("encounterDate") ?? "").trim();

  if (!name) return { error: "Type the client's name so this reaches the right record." };
  if (update.length < 10) {
    return { error: "Write a little more — a few words about what happened." };
  }

  const encounterDate = dateRaw ? new Date(`${dateRaw}T12:00:00`) : new Date();
  if (Number.isNaN(encounterDate.getTime())) {
    return { error: "That date could not be read. Use the date picker." };
  }
  // A contact cannot have happened tomorrow. Caught here rather than trusted
  // from a form that a phone's clock or timezone can skew.
  if (encounterDate.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return { error: "That date is in the future. Pick the day you saw them." };
  }

  const resolved = await resolveClientByName({
    practiceId: session.practiceId,
    typedName: name,
    /*
     * The supervising clinician becomes clinician of record, not the worker.
     *
     * This used to be the agent, which was defensible and wrong in practice: a
     * field agent cannot sign in, so a client assigned to them appeared on
     * nobody's caseload and was swept by nothing. Assigning the nurse who
     * handed out the link puts the client where a clinician will actually see
     * them, and the worker is still recorded on every submission they file.
     */
    therapistId: session.supervisorId ?? session.agent.id,
  });
  if (!resolved.ok) return { error: resolved.error };

  const result = await submitEncounter({
    practiceId: session.practiceId,
    clientId: resolved.client.id,
    submittedBy: session.agent,
    kind: "STRUCTURED",
    templateKind: "NARRATIVE",
    discipline: session.agent.discipline ?? undefined,
    encounterDate,
    fields: { narrative: update },
    // Holds it short of the documentation queue until the clinician who handed
    // out this link has read it.
    reviewBy: session.supervisorId ? { id: session.supervisorId } : null,
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return { error: "That client could not be found. Check the name and try again." };
    }
    /*
     * Refused but recorded. The guardrail turned it away and kept the words —
     * so the worker is told plainly rather than shown a success they did not
     * get, and told that nothing they wrote was thrown away. The alternative,
     * a silent failure, is exactly what this product exists to prevent.
     */
    await noteFieldLinkUse(session.linkId);
    return {
      blocked: `${result.message} Your update was kept and the office has been told — nothing you wrote is lost.`,
    };
  }

  await writeAudit({
    practiceId: session.practiceId,
    actor: session.agent,
    action: "field.update.submitted",
    entityType: "submission",
    entityId: result.submissionId,
    entityLabel: resolved.client.clientCode,
  });

  await noteFieldLinkUse(session.linkId);
  /*
   * The update is filed by this point. Refreshing the office's queue is a
   * convenience on top of that, so a failure here must not reach the worker as
   * "your update did not send" — they would write it again, and the practice
   * would have two records of one contact.
   */
  try {
    revalidatePath("/s");
  } catch {
    /* the queue refreshes on its own next load */
  }

  return {
    success: {
      clientCode: resolved.client.clientCode,
      when: encounterDate.toISOString().slice(0, 10),
      awaitingReview: result.awaitingReview,
    },
  };
}
