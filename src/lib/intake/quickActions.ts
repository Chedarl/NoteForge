"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { submitEncounter } from "@/lib/intake/submit";
import { buildSubmissionPdf, buildBatchPdf } from "@/lib/export/submissionPdf";
import { sendLink, sendFailureMessage, whatsappConfigured } from "@/lib/whatsapp/send";
import { storeSharedPdf, whatsappHandoff } from "@/lib/sharing/store";
import { siteUrl } from "@/lib/email/send";
import { normalizeWhatsAppNumber } from "@/lib/sharing/phone";
import { writeAudit } from "@/lib/audit";
import { logSafe } from "@/lib/redact";
import { resolveClientByName } from "@/lib/clients/resolve";

/**
 * The quick round: type what was discussed for each client, get a PDF, send it.
 *
 * This is the fast path a clinician actually uses in the field. It is a
 * deliberately thin surface over machinery that already exists rather than a
 * second way into the database, and that distinction is the whole point:
 *
 *  - Every entry goes through `submitEncounter`, so the **status guardrail
 *    still runs**, per client. A quick update against a discharged or deceased
 *    client is refused here exactly as it is on the full form, and the
 *    clinician's text is kept. A "simple" path that skipped the guardrail would
 *    be a hole straight through the one rule this product exists to enforce.
 *  - It uses the **NARRATIVE template**, whose single free-text field is already
 *    what this screen collects. No new template, no new field ids, and the
 *    export, the PDF and the duplicate detector all understand it on arrival.
 *  - Duplicate detection, audit and completeness all apply unchanged.
 *
 * One entry and six entries are the same function. There was briefly a separate
 * single-client action beside this one; it was removed rather than kept, because
 * two paths doing the same thing is how the guardrail ends up enforced in one of
 * them.
 *
 * What is new is only the last step: build the document in the same request and
 * send it to the practice's note writer, rather than waiting for someone to
 * fetch it out of the queue.
 */

export interface BatchEntryResult {
  name: string;
  /** Set when it was filed. */
  clientCode?: string;
  created?: boolean;
  /** Set when it was refused or could not be filed. */
  problem?: string;
}

export interface QuickBatchState {
  error?: string;
  success?: {
    filed: BatchEntryResult[];
    refused: BatchEntryResult[];
    filename: string | null;
    downloadIds: string[];
    whatsapp: { sent: boolean; message: string } | null;
    identifiable: boolean;
    /**
     * The six digits the recipient will be asked for, shown once here and
     * nowhere else. Null when the document went out unlocked.
     */
    passcode: string | null;
  };
}

const batchEntrySchema = z.object({
  clientName: z.string().trim().min(2),
  narrative: z.string().trim().min(8),
});

/**
 * A round: several clients written in one sitting, sent as one document.
 *
 * This mirrors what the paper process produces — a single sheet headed with
 * each client in turn — and it is the shape the note writer wants back. Sending
 * one message per client would push the collation work onto the recipient,
 * which is the problem this product removes rather than relocates.
 *
 * Each entry is still an independent submission through `submitEncounter`, so
 * every guarantee holds per client: the guardrail refuses individually, a
 * refusal is kept and flagged individually, and duplicate detection compares
 * against that client's own history. **One refusal does not discard the round.**
 * The others are filed, the document is built from those, and the clinician is
 * told exactly which ones did not go through and why — losing nine updates
 * because the tenth was for a discharged client would be indefensible.
 */
export async function submitQuickBatch(
  _prev: QuickBatchState,
  formData: FormData
): Promise<QuickBatchState> {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  if (!user.discipline) {
    return {
      error:
        "Set your discipline first — it decides what kind of note gets written from this. Go to Your discipline.",
    };
  }

  const occurredAtRaw = String(formData.get("occurredAt") ?? "");
  const encounterDate = new Date(occurredAtRaw);
  if (!occurredAtRaw || Number.isNaN(encounterDate.getTime())) {
    return { error: "Give the date and time these were seen." };
  }
  if (encounterDate.getTime() > Date.now() + 864e5) {
    return { error: "That date and time is in the future." };
  }

  const names = formData.getAll("clientName").map(String);
  const narratives = formData.getAll("narrative").map(String);

  const entries: { clientName: string; narrative: string }[] = [];
  for (let i = 0; i < names.length; i++) {
    // A blank pair is an untouched row, not an error — the form always carries
    // one more than the clinician has filled in.
    if (!names[i]?.trim() && !narratives[i]?.trim()) continue;
    const parsed = batchEntrySchema.safeParse({
      clientName: names[i],
      narrative: narratives[i],
    });
    if (!parsed.success) {
      return {
        error: `Entry ${i + 1} needs a client name and at least a sentence of update.`,
      };
    }
    entries.push(parsed.data);
  }

  if (entries.length === 0) return { error: "Add at least one client update." };

  const includeName = formData.get("includeName") === "on";
  const filed: BatchEntryResult[] = [];
  const refused: BatchEntryResult[] = [];
  const submissionIds: string[] = [];

  for (const entry of entries) {
    const resolved = await resolveClientByName({
      practiceId: user.practiceId,
      typedName: entry.clientName,
      therapistId: user.id,
    });
    if (!resolved.ok) {
      refused.push({ name: entry.clientName, problem: resolved.error });
      continue;
    }

    const result = await submitEncounter({
      practiceId: user.practiceId,
      clientId: resolved.client.id,
      submittedBy: user,
      kind: "STRUCTURED",
      templateKind: "NARRATIVE",
      encounterDate,
      fields: { narrative: entry.narrative },
    });

    if (!result.ok) {
      refused.push({
        name: resolved.client.label,
        clientCode: resolved.client.clientCode,
        problem:
          result.reason === "not_found"
            ? "That client could not be found."
            : result.message,
      });
      continue;
    }

    submissionIds.push(result.submissionId);
    filed.push({
      name: resolved.client.label,
      clientCode: resolved.client.clientCode,
      created: resolved.client.created,
    });
  }

  revalidatePath("/t");

  if (submissionIds.length === 0) {
    return {
      success: {
        filed, refused, filename: null, downloadIds: [],
        whatsapp: null, identifiable: false, passcode: null,
      },
    };
  }

  /*
   * One client is not a round. A single entry gets the §5 document with its
   * proper `[ClientID]_[date]_[type]_[SubmissionID].pdf` name, because that name
   * is meant to be split by a machine and "round_1-clients" would be a lie about
   * what the file is. Only a genuine batch becomes a batch.
   */
  const batch =
    submissionIds.length === 1
      ? await buildSubmissionPdf({
          submissionId: submissionIds[0],
          practiceId: user.practiceId,
          includeName,
        }).then((single) =>
          single
            ? {
                pdf: single.pdf,
                filename: single.filename,
                clientCodes: [single.clientCode],
                identifiable: single.identifiable,
              }
            : null
        )
      : await buildBatchPdf({
          submissionIds,
          practiceId: user.practiceId,
          includeName,
        });

  if (!batch) {
    logSafe("quick", "batch pdf build returned nothing", { count: submissionIds.length });
    return {
      error:
        "The updates were saved, but the document could not be built. Open them from your client list.",
    };
  }

  const practice = await prisma.practice.findUnique({
    where: { id: user.practiceId },
    select: { noteWriterWhatsApp: true },
  });
  /*
   * The destination is the clinician's to choose, every time. It is prefilled
   * with the practice's usual note writer because that is what it is nine times
   * out of ten, but it is an ordinary editable field and not a setting buried
   * two screens away: cover arrangements, a second note writer and "send this
   * one to me instead" are all normal, and none of them should require an admin.
   */
  const sendToRaw = String(formData.get("sendTo") ?? "").trim();
  const destination = sendToRaw || practice?.noteWriterWhatsApp || null;

  if (destination && !normalizeWhatsAppNumber(destination)) {
    return {
      error: "That WhatsApp number does not look right. Use the international form, like +1 415 555 0123.",
    };
  }

  /*
   * Saving it as the practice default is deliberately owner-only. A per-send
   * number affects one document; the default silently redirects every future
   * one, and a colleague changing where the whole practice's clinical material
   * goes is not something that should happen from a checkbox on an update form.
   */
  if (formData.get("saveDefault") === "on" && sendToRaw && user.role === "OWNER") {
    const normalised = normalizeWhatsAppNumber(sendToRaw);
    if (normalised && normalised !== practice?.noteWriterWhatsApp) {
      await prisma.practice.update({
        where: { id: user.practiceId },
        data: { noteWriterWhatsApp: normalised },
      });
      await writeAudit({
        practiceId: user.practiceId,
        actor: user,
        action: "practice.note_writer_number_set",
        entityType: "user",
        entityId: user.id,
        entityLabel: user.fullName,
        // The number is not logged: an audit row is read by more people than a
        // settings screen, and the destination changing is the fact that matters.
        changes: { noteWriterWhatsApp: { from: practice?.noteWriterWhatsApp ? "set" : "unset", to: "set" } },
      });
    }
  }

  /*
   * The document is stored and a *link* is sent, rather than the PDF being
   * pushed into the chat.
   *
   * The bytes stay in the practice's bucket, where the link expires, counts its
   * downloads and can be withdrawn. What ends up in a WhatsApp backup is a URL
   * that has since stopped working, instead of a clinical PDF that never will.
   *
   * A round carrying decrypted client names is locked with a code and there is
   * no way to opt out of that: names in a chat backup are the worst version of
   * this and the one thing no agreement covers.
   */
  let whatsapp: { sent: boolean; message: string } | null = null;
  let passcode: string | null = null;

  const stored = await storeSharedPdf({
    user,
    bytes: new Uint8Array(batch.pdf),
    documentKind: submissionIds.length === 1 ? "submission" : "round",
    submissionId: submissionIds[0],
    auditLabel: batch.clientCodes.join(", "),
    requirePasscode: batch.identifiable,
  });

  if (!stored.ok) {
    return {
      error: `${stored.error} The updates themselves are filed and safe.`,
    };
  }
  passcode = stored.share.passcode;

  const { whatsappUrl, downloadUrl } = whatsappHandoff({
    phone: destination,
    siteUrl: siteUrl(),
    token: stored.share.token,
    ttlHours: stored.share.ttlHours,
    lead: `${batch.clientCodes.length} client update${batch.clientCodes.length === 1 ? "" : "s"} for note production, ${encounterDate.toISOString().slice(0, 10)}.`,
  });
  void whatsappUrl;

  if (whatsappConfigured()) {
    const sent = await sendLink({
      to: destination ?? "",
      url: downloadUrl,
      lead: `${batch.clientCodes.length} client update${batch.clientCodes.length === 1 ? "" : "s"} for note production, ${encounterDate.toISOString().slice(0, 10)}. The link expires in ${stored.share.ttlHours} hours.${passcode ? " You will be asked for a code — it is being sent to you separately." : ""}`,
    });

    await writeAudit({
      practiceId: user.practiceId,
      actor: user,
      action: sent.ok
        ? batch.identifiable
          ? "submission.whatsapp_sent_with_names"
          : "submission.whatsapp_sent"
        : "submission.whatsapp_send_failed",
      entityType: "submission",
      entityId: submissionIds[0],
      entityLabel: `round of ${batch.clientCodes.length}`,
      changes: {
        identifiable: { from: null, to: batch.identifiable },
        clients: { from: null, to: batch.clientCodes.join(", ") },
        outcome: { from: null, to: sent.ok ? "sent" : sent.reason },
        // What went out was a link, not the document. Worth recording, because
        // "was the PDF itself ever in a chat" is a question an audit will ask.
        delivery: { from: null, to: "link" },
        passcodeProtected: { from: null, to: passcode !== null },
      },
    });

    whatsapp = sent.ok
      ? { sent: true, message: "Sent to the note writer on WhatsApp." }
      : { sent: false, message: sendFailureMessage(sent) };
  }

  return {
    success: {
      filed,
      refused,
      filename: batch.filename,
      downloadIds: submissionIds,
      whatsapp,
      identifiable: batch.identifiable,
      passcode,
    },
  };
}
