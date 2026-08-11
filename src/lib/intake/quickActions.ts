"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { submitEncounter } from "@/lib/intake/submit";
import { buildSubmissionPdf } from "@/lib/export/submissionPdf";
import { sendDocument, sendFailureMessage, whatsappConfigured } from "@/lib/whatsapp/send";
import { writeAudit } from "@/lib/audit";
import { logSafe } from "@/lib/redact";

/**
 * The quick update: type what was discussed, get a PDF, send it.
 *
 * This is the fast path a clinician actually uses in the field. It is a
 * deliberately thin surface over machinery that already exists rather than a
 * second way into the database, and that distinction is the whole point:
 *
 *  - It goes through `submitEncounter`, so the **status guardrail still runs**.
 *    A quick update against a discharged or deceased client is refused here
 *    exactly as it is on the full form, and the clinician's text is kept. A
 *    "simple" path that skipped the guardrail would be a hole straight through
 *    the one rule this product exists to enforce.
 *  - It uses the **NARRATIVE template**, whose single free-text field is already
 *    what this screen collects. No new template, no new field ids, and the
 *    export, the PDF and the duplicate detector all understand it on arrival.
 *  - Duplicate detection, audit and completeness all apply unchanged.
 *
 * What is new is only the last step: build the PDF in the same request and send
 * it to the practice's note writer, rather than waiting for someone to fetch it
 * out of the queue.
 */

export interface QuickUpdateState {
  error?: string;
  blocked?: { message: string; status: string; since?: string };
  success?: {
    submissionId: string;
    filename: string;
    flagged: boolean;
    /** Null when delivery was not attempted because it is not configured. */
    whatsapp: { sent: boolean; message: string } | null;
  };
}

const schema = z.object({
  clientId: z.string().min(1),
  /**
   * The floor is the same eight characters the completeness gate uses. It
   * catches the empty box and the stray keystroke and nothing more — refereeing
   * how much a clinician should write is not this tool's business.
   */
  narrative: z.string().trim().min(8),
  /** `datetime-local`, so the record carries the time as well as the day. */
  occurredAt: z.string().min(1),
});

export async function submitQuickUpdate(
  _prev: QuickUpdateState,
  formData: FormData
): Promise<QuickUpdateState> {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  if (!user.discipline) {
    return {
      error:
        "Set your discipline first — it decides what kind of note gets written from this. Go to Your discipline.",
    };
  }

  const parsed = schema.safeParse({
    clientId: formData.get("clientId"),
    narrative: formData.get("narrative"),
    occurredAt: formData.get("occurredAt"),
  });
  if (!parsed.success) {
    return { error: "Choose a client, give the date and time, and write what was discussed." };
  }

  const encounterDate = new Date(parsed.data.occurredAt);
  if (Number.isNaN(encounterDate.getTime())) {
    return { error: "That date and time is not valid." };
  }
  if (encounterDate.getTime() > Date.now() + 864e5) {
    return { error: "That date and time is in the future." };
  }

  const includeName = formData.get("includeName") === "on";

  const result = await submitEncounter({
    practiceId: user.practiceId,
    clientId: parsed.data.clientId,
    submittedBy: user,
    kind: "STRUCTURED",
    templateKind: "NARRATIVE",
    encounterDate,
    fields: { narrative: parsed.data.narrative },
  });

  if (!result.ok && result.reason === "not_found") {
    return { error: "That client could not be found." };
  }
  if (!result.ok) {
    // Refused on status. The text is already saved as BLOCKED and flagged; the
    // clinician is told why rather than losing what they wrote.
    return {
      blocked: {
        message: result.message,
        status: result.status,
        since: result.since?.toISOString(),
      },
    };
  }

  revalidatePath("/t");

  const pdf = await buildSubmissionPdf({
    submissionId: result.submissionId,
    practiceId: user.practiceId,
    includeName,
  });

  if (!pdf) {
    // The submission is saved either way; only the document failed.
    logSafe("quick", "pdf build returned nothing", { submissionId: result.submissionId });
    return {
      error: "The update was saved, but the PDF could not be built. Open it from your client list.",
    };
  }

  const practice = await prisma.practice.findUnique({
    where: { id: user.practiceId },
    select: { noteWriterWhatsApp: true },
  });

  const whatsapp = await deliver({
    user,
    pdf,
    submissionId: result.submissionId,
    to: practice?.noteWriterWhatsApp ?? null,
  });

  return {
    success: {
      submissionId: result.submissionId,
      filename: pdf.filename,
      flagged: result.flagged,
      whatsapp,
    },
  };
}

/**
 * Delivery, and the record of it.
 *
 * Audited whether it succeeds or fails, and identifiable sends are a distinct
 * action from de-identified ones — the same split the download routes use. A
 * document going out over an unsigned channel is the single most consequential
 * thing this application does, so "what left, to whom, when, and was it
 * identifiable" has to be answerable afterwards.
 */
async function deliver(args: {
  user: Awaited<ReturnType<typeof requireRole>>;
  pdf: NonNullable<Awaited<ReturnType<typeof buildSubmissionPdf>>>;
  submissionId: string;
  /**
   * The practice's note writer, not the clinician who typed this. The document
   * exists so a note can be written from it, and the person who writes the note
   * is the one who needs it — the author already has it on screen and can
   * download it from the confirmation.
   */
  to: string | null;
}): Promise<{ sent: boolean; message: string } | null> {
  const { user, pdf, submissionId, to } = args;

  if (!whatsappConfigured()) return null;

  const result = await sendDocument({
    to: to ?? "",
    pdf: pdf.pdf,
    filename: pdf.filename,
    // Client code and date. Never the narrative — a message preview shows on a
    // lock screen, and that is not where a session belongs.
    caption: `${pdf.clientCode} · session ${pdf.encounterDate}`,
  });

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: result.ok
      ? pdf.identifiable
        ? "submission.whatsapp_sent_with_names"
        : "submission.whatsapp_sent"
      : "submission.whatsapp_send_failed",
    entityType: "submission",
    entityId: submissionId,
    entityLabel: `${pdf.clientCode} · ${pdf.encounterDate}`,
    changes: {
      identifiable: { from: null, to: pdf.identifiable },
      outcome: { from: null, to: result.ok ? "sent" : result.reason },
    },
  });

  return result.ok
    ? { sent: true, message: "Sent to the note writer on WhatsApp." }
    : { sent: false, message: sendFailureMessage(result) };
}
