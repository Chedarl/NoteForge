"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { submitEncounter } from "@/lib/intake/submit";
import { assessCompleteness, TEMPLATES, readField } from "@/lib/intake/templates";
import { writeAudit } from "@/lib/audit";
import { changeClientStatus, StatusChangeError } from "@/lib/clients/status";
import { templatesFor } from "@/lib/intake/disciplines";
import type { TemplateKind, ClientStatus } from "@prisma/client";

/**
 * Server actions for the therapist portal.
 *
 * Every one of these re-checks the role and re-scopes to the caller's practice.
 * Nothing trusts an id that arrived from a form: a client id is always looked up
 * with `practiceId` in the where clause, so a guessed or stale id is a
 * not-found rather than a window into another practice.
 */

export interface IntakeState {
  error?: string;
  /** Set when the guardrail refused it — rendered as an explanation, not an error. */
  blocked?: { message: string; status: string; since?: string };
  success?: { submissionId: string; flagged: boolean };
  missing?: string[];
}

const intakeSchema = z.object({
  clientId: z.string().min(1),
  templateKind: z.enum([
    "SOAP",
    "DAP",
    "BIRP",
    "NARRATIVE",
    "CASE_MANAGEMENT",
    "NURSING",
  ]),
  encounterDate: z.string().min(1),
});

export async function submitStructuredNote(
  _prev: IntakeState,
  formData: FormData
): Promise<IntakeState> {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  // A submission with no discipline produces an export that cannot be turned
  // into the right kind of note, so the door is shut until it is recorded.
  if (!user.discipline) {
    return {
      error:
        "Set your discipline before submitting — it decides what kind of note gets written from this. Go to Your discipline.",
    };
  }

  const parsed = intakeSchema.safeParse({
    clientId: formData.get("clientId"),
    templateKind: formData.get("templateKind"),
    encounterDate: formData.get("encounterDate"),
  });
  if (!parsed.success) return { error: "Choose a client, a template and the session date." };

  const templateKind = parsed.data.templateKind as TemplateKind;
  if (!templatesFor(user.discipline).includes(templateKind)) {
    return { error: "That template is not one of the ones available to your discipline." };
  }

  const encounterDate = new Date(parsed.data.encounterDate);
  if (Number.isNaN(encounterDate.getTime())) return { error: "That session date is not valid." };
  // A session cannot have happened tomorrow. Catching it here saves a nonsense
  // date propagating into turnaround figures and duplicate-window arithmetic.
  if (encounterDate.getTime() > Date.now() + 864e5) {
    return { error: "The session date is in the future." };
  }

  const fields: Record<string, unknown> = {};
  for (const field of TEMPLATES[templateKind].fields) {
    fields[field.id] = readField(field, formData);
  }

  const completeness = assessCompleteness(templateKind, fields);
  if (!completeness.complete) {
    return {
      error: "Some required sections are empty or too short to be a record.",
      missing: completeness.missing,
    };
  }

  const result = await submitEncounter({
    practiceId: user.practiceId,
    clientId: parsed.data.clientId,
    submittedBy: user,
    kind: "STRUCTURED",
    templateKind,
    encounterDate,
    fields,
  });

  if (!result.ok && result.reason === "not_found") {
    return { error: "That client could not be found." };
  }
  if (!result.ok) {
    return {
      blocked: {
        message: result.message,
        status: result.status,
        since: result.since?.toISOString(),
      },
    };
  }

  revalidatePath("/t");
  return { success: { submissionId: result.submissionId, flagged: result.flagged } };
}

/**
 * A therapist correcting a status themselves.
 *
 * This is the mechanism that actually fixes the original problem. The team
 * finding out weeks late happened because telling somebody was a phone call or
 * an email that never got made; it has to be three taps from the client list,
 * available to the clinician who knows, at the moment they know.
 */
export async function updateClientStatus(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireRole(["THERAPIST", "OWNER", "SPECIALIST"]);

  const clientId = String(formData.get("clientId") ?? "");
  const toStatus = String(formData.get("status") ?? "") as ClientStatus;
  const reason = String(formData.get("reason") ?? "").trim();

  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      practiceId: user.practiceId,
      // A therapist may only change their own clients. Owners and specialists
      // are not restricted, because reconciling a status somebody else got
      // wrong is precisely their job.
      ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
    },
  });
  if (!client) return { error: "That client could not be found." };

  try {
    await changeClientStatus({
      client,
      toStatus,
      reason: reason || null,
      actor: user,
      source: user.role === "THERAPIST" ? "THERAPIST_UPDATE" : "ADMIN",
    });
  } catch (error) {
    if (error instanceof StatusChangeError) return { error: error.message };
    throw error;
  }

  revalidatePath("/t");
  revalidatePath("/s/clients");
  return { ok: true };
}

/** Records that a therapist opened a client's history. Reads are audited too. */
export async function noteClientViewed(clientId: string) {
  const user = await requireRole(["THERAPIST", "OWNER", "SPECIALIST"]);
  const client = await prisma.client.findFirst({
    where: { id: clientId, practiceId: user.practiceId },
    select: { id: true, clientCode: true },
  });
  if (!client) return;
  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "client.viewed",
    entityType: "client",
    entityId: client.id,
    entityLabel: client.clientCode,
  });
}
