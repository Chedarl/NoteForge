import "server-only";

import { prisma } from "@/lib/prisma";
import { draftNote } from "@/lib/ai/noteDraft";
import { kimiConfigured } from "@/lib/ai/kimi";
import { openText, sealJson } from "@/lib/crypto/text";
import { buildSubmissionPdf } from "@/lib/export/submissionPdf";
import { storeSharedPdf, whatsappHandoff } from "@/lib/sharing/store";
import { emailShareLink } from "@/lib/sharing/email";
import { siteUrl } from "@/lib/email/send";
import { writeAudit } from "@/lib/audit";
import { logSafe } from "@/lib/redact";
import type { Prisma, TemplateKind, User } from "@prisma/client";

/**
 * Transcribe, write, and send — without stopping at a queue.
 *
 * ## What this changes, stated plainly
 *
 * The original design routed every photographed page through a human who
 * confirmed the transcript before anything was produced from it, and `CLAUDE.md`
 * rule 3 says a machine may propose while only a named human commits. This path
 * is a deliberate product decision by the practice that owns the product: an
 * update should reach the note writer immediately, with a copy back to the
 * clinician who sent it, rather than waiting in a queue.
 *
 * Two things are kept, because they cost nothing and are the difference between
 * "fast" and "indefensible":
 *
 * - **The note is never signed by this code.** It is stored as a DRAFT with
 *   `aiAssisted: true` and no `signedById`, so the record answers "did a person
 *   put their name to this" truthfully — *no* — while the document still goes
 *   out at once. Marking it signed would be a second, separate decision, and it
 *   is the one that cannot be undone after an audit asks.
 * - **Nothing is invented.** `draftNote` reorganises the source and returns an
 *   empty field plus a stated gap where the source does not support one. That
 *   constraint is what makes an unreviewed note merely incomplete rather than
 *   wrong, and it is the reason this is safe enough to send unattended.
 *
 * ## Why it refuses rather than sends when there is no text
 *
 * The screen that prompted this change showed exactly the case: a photographed
 * page the reader returned nothing for, and "Page 1 still has no text". Sending
 * immediately on that input would deliver a note writer an empty document with
 * a client code on it, which is worse than a queue — they cannot tell an empty
 * note from a quiet week. So no text means no delivery, the submission stays
 * where a person can type it, and the caller is told which of the two happened.
 */

export type DeliveryOutcome =
  | {
      ok: true;
      noteId: string;
      /** Present when the link was minted; the passcode is shown once. */
      share: { token: string; passcode: string | null; url: string };
      /** What actually left the building, for the screen to report honestly. */
      sent: { noteWriterEmail: boolean; clinicianEmail: boolean; whatsappUrl: string | null };
      gaps: string[];
    }
  | {
      ok: false;
      reason: "no_text" | "no_model" | "draft_failed" | "store_failed";
      message: string;
    };

/** Everything the drafter can be given about this encounter, as one string. */
function sourceTextOf(submission: {
  rawTextEnc: string;
  pages: { verifiedTextEnc: string | null; ocrTextEnc: string | null }[];
}): string {
  const raw = openText(submission.rawTextEnc) ?? "";
  /*
   * The confirmed transcript when a human has typed one, otherwise the machine
   * reading. That ordering matters and is the one concession this path makes to
   * the review it replaces: if somebody *has* already corrected a page, their
   * text wins over the OCR every time.
   */
  const pages = submission.pages
    .map((page) => openText(page.verifiedTextEnc) ?? openText(page.ocrTextEnc) ?? "")
    .filter((text) => text.trim());

  return [raw, ...pages].filter((part) => part.trim()).join("\n\n").trim();
}

export async function autoDeliverSubmission(
  submissionId: string,
  user: User
): Promise<DeliveryOutcome> {
  const submission = await prisma.submission.findFirst({
    // Practice-scoped in the query, so an id from another tenant is a not-found
    // rather than an error that confirms the row exists.
    where: { id: submissionId, practiceId: user.practiceId },
    include: {
      client: { select: { clientCode: true } },
      note: { select: { id: true, state: true } },
      pages: {
        orderBy: { pageNumber: "asc" },
        select: { verifiedTextEnc: true, ocrTextEnc: true },
      },
      practice: { select: { name: true, noteWriterWhatsApp: true } },
    },
  });
  if (!submission) {
    return { ok: false, reason: "no_text", message: "That submission could not be found." };
  }

  const source = sourceTextOf(submission);
  if (!source) {
    return {
      ok: false,
      reason: "no_text",
      message:
        "There is no text to write from yet — the reader returned nothing for these pages. " +
        "Type what the page says and it will be sent as soon as you confirm it.",
    };
  }

  if (!kimiConfigured()) {
    return {
      ok: false,
      reason: "no_model",
      message:
        "Automatic note writing is switched off on this deployment, so this went to the queue " +
        "for somebody to write. The material itself is saved and nothing is lost.",
    };
  }

  const kind = submission.templateKind as TemplateKind;
  const draft = await draftNote(kind, source);
  if (!draft) {
    return {
      ok: false,
      reason: "draft_failed",
      message:
        "The note could not be written automatically this time. The submission is saved and " +
        "is in the queue — nothing has been lost.",
    };
  }

  /*
   * Stored as a DRAFT with `aiAssisted` set and nobody named as author.
   *
   * This is the honest record of what happened: a machine produced it and no
   * person has yet stood behind it. The document still goes out below — speed
   * was the requirement — but "who signed this" keeps its real answer, and a
   * specialist opening the note editor gets the generated text to correct
   * rather than a blank page.
   */
  const note = submission.note
    ? await prisma.note.update({
        where: { id: submission.note.id },
        data: {
          bodyEnc: sealJson(draft.fields) as unknown as Prisma.InputJsonObject,
          aiAssisted: true,
        },
        select: { id: true },
      })
    : await prisma.note.create({
        data: {
          practiceId: submission.practiceId,
          clientId: submission.clientId,
          submissionId: submission.id,
          templateKind: kind,
          bodyEnc: sealJson(draft.fields) as unknown as Prisma.InputJsonObject,
          aiAssisted: true,
          state: "DRAFT",
        },
        select: { id: true },
      });

  const pdf = await buildSubmissionPdf({
    submissionId: submission.id,
    practiceId: user.practiceId,
    includeName: false,
    // The produced note, not the raw submission — that is what a note writer
    // receiving this is meant to read.
    fromNote: true,
  });
  if (!pdf) {
    return {
      ok: false,
      reason: "store_failed",
      message: "The note was written but the document could not be built. It is in the queue.",
    };
  }

  const stored = await storeSharedPdf({
    user,
    bytes: new Uint8Array(pdf.pdf),
    documentKind: "submission",
    submissionId: submission.id,
    auditLabel: submission.client.clientCode,
    // De-identified — `includeName: false` above — so the sender would normally
    // be allowed to decline the code. Nobody is standing here to decline it, so
    // it is locked. An unattended send is exactly the case where a bearer link
    // sitting in a chat is least likely to be noticed.
    requirePasscode: true,
  });
  if (!stored.ok) {
    return { ok: false, reason: "store_failed", message: stored.error };
  }

  const handoff = whatsappHandoff({
    phone: submission.practice.noteWriterWhatsApp,
    siteUrl: siteUrl(),
    token: stored.share.token,
    ttlHours: stored.share.ttlHours,
    lead: `A note is ready for ${submission.client.clientCode}.`,
  });

  const url = `${siteUrl()}/share/${stored.share.token}`;

  /*
   * A copy back to the person who sent it, which is the half of this request
   * that is easy to forget. A case worker who speaks an update into a phone has
   * no other record that it turned into anything — and if what came back is
   * wrong, they are the only person who can tell.
   */
  const locked = stored.share.passcode !== null;
  const send = (to: string) =>
    emailShareLink({
      to,
      downloadUrl: url,
      ttlHours: stored.share.ttlHours,
      locked,
      senderName: user.fullName,
      practiceName: submission.practice.name,
    });

  const clinicianEmail = user.email ? await send(user.email) : { ok: false as const };

  let noteWriterEmail: { ok: boolean } = { ok: false };
  const writerAddress = process.env.NOTE_WRITER_EMAIL?.trim();
  if (writerAddress) noteWriterEmail = await send(writerAddress);

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "note.auto_delivered",
    entityType: "submission",
    entityId: submission.id,
    entityLabel: submission.client.clientCode,
    changes: {
      // Never the note text. Rule 6 holds on this path like every other.
      authored: { from: null, to: "machine, unsigned" },
      gaps: { from: null, to: String(draft.gaps.length) },
      copyToClinician: { from: null, to: clinicianEmail.ok ? "sent" : "not sent" },
      copyToNoteWriter: { from: null, to: noteWriterEmail.ok ? "sent" : "not configured" },
    },
  });

  logSafe("auto-deliver", "note produced and shared", {
    submissionId: submission.id,
    gaps: draft.gaps.length,
  });

  return {
    ok: true,
    noteId: note.id,
    share: { token: stored.share.token, passcode: stored.share.passcode, url },
    sent: {
      noteWriterEmail: noteWriterEmail.ok,
      clinicianEmail: clinicianEmail.ok,
      whatsappUrl: handoff.whatsappUrl,
    },
    gaps: draft.gaps,
  };
}
