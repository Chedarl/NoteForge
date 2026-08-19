"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { finishVerification } from "@/lib/intake/submit";
import { assessCompleteness, TEMPLATES, flattenFields, readField } from "@/lib/intake/templates";
import { draftNote } from "@/lib/ai/noteDraft";
import { Prisma } from "@prisma/client";
import type { FlagResolution, TagKind, TemplateKind } from "@prisma/client";

/**
 * Everything your team does to a submission.
 *
 * The single invariant across this file: **a machine may propose, only a named
 * human may commit.** Verification is a human confirming a transcript. Flag
 * resolution is a human choosing. Signing is a human, recorded by name and
 * timestamp, and it freezes the note. There is no code path anywhere in this
 * project that signs a note or resolves a flag automatically, and adding one
 * would remove the reason a practice can defend using this at all.
 */

async function requireStaff() {
  return requireRole(["OWNER", "SPECIALIST"]);
}

/** Scopes a submission to the caller's practice. A foreign id is a not-found. */
async function loadSubmission(id: string, practiceId: string) {
  return prisma.submission.findFirst({
    where: { id, practiceId },
    include: {
      client: true,
      pages: { orderBy: { pageNumber: "asc" } },
      note: true,
    },
  });
}

// ── Verification ────────────────────────────────────────────────────────────

export interface VerifyState {
  error?: string;
  ok?: boolean;
}

/**
 * Saves the confirmed transcript for every page and moves the submission into
 * the queue.
 *
 * A page whose text is still empty blocks the whole submission. Letting a blank
 * page through would mean a note produced from a source somebody never actually
 * read, which is the one outcome this workspace exists to prevent.
 */
export async function saveVerification(
  _prev: VerifyState,
  formData: FormData
): Promise<VerifyState> {
  const user = await requireStaff();
  const submissionId = String(formData.get("submissionId") ?? "");

  const submission = await loadSubmission(submissionId, user.practiceId);
  if (!submission) return { error: "That submission could not be found." };

  // Validate the entire form before writing any page. Previously, pages before
  // an empty one were marked verified even though the submission was rejected.
  const transcripts = submission.pages.map((page) => ({
    page,
    text: String(formData.get(`page_${page.id}`) ?? "").trim(),
  }));
  const empty = transcripts.filter(({ text }) => !text).map(({ page }) => page.pageNumber);

  if (empty.length > 0) {
    return {
      error: `Page ${empty.join(", ")} still has no text. Type what you can read, or write "[illegible]" — a page cannot be left blank.`,
    };
  }

  const verifiedAt = new Date();
  await prisma.$transaction(
    transcripts.map(({ page, text }) =>
      prisma.submissionPage.update({
        where: { id: page.id },
        data: { verifiedText: text, verifiedAt, verifiedById: user.id },
      })
    )
  );

  const flagged = await finishVerification(submissionId);

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "submission.verified",
    entityType: "submission",
    entityId: submissionId,
    entityLabel: submission.client.clientCode,
    changes: { state: { from: submission.state, to: "QUEUED" } },
  });

  revalidatePath("/s");
  redirect(`/s/note/${submissionId}${flagged ? "?flagged=1" : ""}`);
}

// ── Flags ───────────────────────────────────────────────────────────────────

/**
 * A human's decision about a flagged pair.
 *
 * `DISMISSED_DUPLICATE` and `MARKED_UPDATE` are the only two resolutions that
 * change a submission's state, and both set it to SUPERSEDED — never deleted.
 * The therapist wrote an account of a real session; if it turns out to be a
 * second copy, it stops consuming the queue, and it stays readable forever.
 */
export async function resolveFlag(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireStaff();
  const flagId = String(formData.get("flagId") ?? "");
  const resolution = String(formData.get("resolution") ?? "") as FlagResolution;

  const flag = await prisma.submissionFlag.findFirst({
    where: { id: flagId, submission: { practiceId: user.practiceId } },
    include: { submission: { select: { id: true, clientId: true } } },
  });
  if (!flag) return { error: "That flag could not be found." };

  await prisma.submissionFlag.update({
    where: { id: flagId },
    data: { resolution, resolvedAt: new Date(), resolvedById: user.id },
  });

  if (resolution === "DISMISSED_DUPLICATE" || resolution === "MARKED_UPDATE") {
    await prisma.submission.update({
      where: { id: flag.submissionId },
      data: {
        state: "SUPERSEDED",
        supersedesId: resolution === "MARKED_UPDATE" ? flag.relatedSubmissionId : null,
      },
    });
  }

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "flag.resolved",
    entityType: "flag",
    entityId: flagId,
    changes: { resolution: { from: "OPEN", to: resolution } },
  });

  revalidatePath("/s");
  return { ok: true };
}

// ── Note production ─────────────────────────────────────────────────────────

export interface NoteState {
  error?: string;
  missing?: string[];
  saved?: boolean;
  signed?: boolean;
}

/** Creates the note row on first open, so the editor always has something to edit. */
export async function ensureNote(submissionId: string) {
  const user = await requireStaff();
  const submission = await loadSubmission(submissionId, user.practiceId);
  if (!submission) return null;
  /*
   * A field update that no clinician has read yet is not writable, even by URL.
   *
   * The queue no longer lists these, but "not linked to" is not a boundary — a
   * pasted or bookmarked id would otherwise open the editor and, worse, flip the
   * submission to IN_PROGRESS, taking it out of the nurse's queue without her
   * ever seeing it. Returning null puts the caller on its not-found path.
   */
  if (submission.state === "AWAITING_REVIEW") return null;
  if (submission.note) return submission.note;

  const note = await prisma.note.create({
    data: {
      practiceId: submission.practiceId,
      clientId: submission.clientId,
      submissionId: submission.id,
      templateKind: submission.templateKind,
      // Structured intake starts pre-filled with what the clinician wrote. There
      // is no reason to retype words that are already in their own voice.
      body: (submission.kind === "STRUCTURED" ? submission.fields : {}) as object,
      authoredById: user.id,
    },
  });

  if (submission.state === "QUEUED") {
    await prisma.submission.update({
      where: { id: submission.id },
      data: { state: "IN_PROGRESS" },
    });
  }
  return note;
}

export async function saveNote(_prev: NoteState, formData: FormData): Promise<NoteState> {
  const user = await requireStaff();
  const submissionId = String(formData.get("submissionId") ?? "");
  const intent = String(formData.get("intent") ?? "save");

  const submission = await loadSubmission(submissionId, user.practiceId);
  if (!submission || !submission.note) return { error: "That note could not be found." };

  const templateKind = submission.note.templateKind as TemplateKind;
  /*
   * Read by field type, not as strings.
   *
   * `String(formData.get(id))` destroyed a picker's answer on the first save of
   * the note — the array arrived from the submission, was coerced to
   * "housing,food", and the structure was gone for good. A multi field is read
   * with `getAll`, which is also the only way a repeated checkbox name survives
   * at all.
   */
  const body: Record<string, unknown> = {};
  for (const field of TEMPLATES[templateKind].fields) {
    body[field.id] = readField(field, formData);
  }

  if (intent === "sign") {
    // The completeness gate. Deliberately at signing rather than at save, so a
    // half-finished note can be parked and picked up, but nothing incomplete can
    // ever be handed to a practice.
    const completeness = assessCompleteness(templateKind, body, submission.encounterDate);
    if (!completeness.complete) {
      return {
        error: "This note cannot be signed while required sections are empty.",
        missing: completeness.missing,
      };
    }

    if (submission.note.state === "SIGNED" || submission.note.state === "DELIVERED") {
      // Editing after signature is allowed — corrections happen — but it is a
      // new version, and the version number is what makes that visible.
      await prisma.note.update({
        where: { id: submission.note.id },
        data: {
          body: body as Prisma.InputJsonObject,
          version: { increment: 1 },
          signedById: user.id,
          signedAt: new Date(),
        },
      });
    } else {
      await prisma.note.update({
        where: { id: submission.note.id },
        data: {
          body: body as Prisma.InputJsonObject,
          state: "SIGNED",
          signedById: user.id,
          signedAt: new Date(),
          deliveredAt: new Date(),
        },
      });
      await prisma.submission.update({
        where: { id: submission.id },
        data: { state: "DONE" },
      });
    }

    await writeAudit({
      practiceId: user.practiceId,
      actor: user,
      action: "note.signed",
      entityType: "note",
      entityId: submission.note.id,
      entityLabel: submission.client.clientCode,
      changes: { state: { from: submission.note.state, to: "SIGNED" } },
    });

    revalidatePath("/s");
    return { signed: true };
  }

  await prisma.note.update({
    where: { id: submission.note.id },
    data: { body: body as Prisma.InputJsonObject },
  });
  return { saved: true };
}

/**
 * Asks the model for a draft.
 *
 * Runs on the *verified* transcript, never on raw OCR — otherwise a misread
 * digit gets rewritten as fluent prose and stops looking like a misread digit.
 * The result lands in the editor as text a person then edits and signs; the
 * note is marked `aiAssisted` whether or not a word of it survives, because the
 * honest answer to "was a machine involved" is yes.
 */
export async function proposeDraft(
  _prev: { error?: string; fields?: Record<string, string>; gaps?: string[] },
  formData: FormData
): Promise<{ error?: string; fields?: Record<string, string>; gaps?: string[] }> {
  const user = await requireStaff();
  const submissionId = String(formData.get("submissionId") ?? "");

  const submission = await loadSubmission(submissionId, user.practiceId);
  if (!submission) return { error: "That submission could not be found." };

  const source =
    submission.kind === "PHOTO"
      ? submission.pages.map((p) => p.verifiedText ?? "").join("\n\n").trim()
      : flattenFields(submission.templateKind as TemplateKind, submission.fields as Record<string, unknown>);

  if (!source) {
    return { error: "There is no verified source text to draft from yet." };
  }

  const draft = await draftNote(submission.templateKind as TemplateKind, source);
  if (!draft) {
    return {
      error:
        "The drafting assistant is unavailable. Write the note directly — the source is beside you.",
    };
  }

  if (submission.note) {
    await prisma.note.update({
      where: { id: submission.note.id },
      data: { aiAssisted: true },
    });
  }

  return { fields: draft.fields, gaps: draft.gaps };
}

/** Tags are the entire basis of the clinical half of the insights page. */
export async function addNoteTag(
  _prev: { error?: string; ok?: boolean },
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireStaff();
  const noteId = String(formData.get("noteId") ?? "");
  const kind = String(formData.get("kind") ?? "") as TagKind;
  const label = String(formData.get("label") ?? "").trim();

  if (!label) return { error: "Give the tag a short label." };

  const note = await prisma.note.findFirst({
    where: { id: noteId, practiceId: user.practiceId },
    select: { id: true },
  });
  if (!note) return { error: "That note could not be found." };

  await prisma.noteTag.create({ data: { noteId, kind, label } });
  revalidatePath(`/s/note`);
  return { ok: true };
}

export interface ProcessedState {
  error?: string;
  ok?: boolean;
}

/**
 * "This one is filed."
 *
 * The last step in the chain happens somewhere this product cannot see: a
 * person opens Credible or ICANotes and types the note in. `DONE` has always
 * meant *a note was produced here*, and from inside the system a note that was
 * entered and one that was forgotten look exactly the same. That gap is where
 * work actually goes missing — and it is the gap the practice gets asked about
 * when a claim comes back.
 *
 * So it is recorded by hand, by a named person, with the note version they
 * filed and whatever reference the destination gave back. Nothing sets it
 * automatically: "was this actually filed" is the one question nobody should be
 * able to answer on somebody else's behalf.
 *
 * Reversible on purpose. Marking the wrong row is an ordinary mistake, and a
 * one-way flag makes people hesitate before using it at all — which produces a
 * field nobody trusts. Both directions are audited.
 */
export async function markProcessed(
  _prev: ProcessedState,
  formData: FormData
): Promise<ProcessedState> {
  const user = await requireStaff();
  const submissionId = String(formData.get("submissionId") ?? "");
  const undo = formData.get("undo") === "yes";
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 120);

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, practiceId: user.practiceId },
    include: { note: { select: { state: true, version: true } }, client: { select: { clientCode: true } } },
  });
  if (!submission) return { error: "That submission could not be found." };

  if (!undo) {
    /*
     * Only a signed note can be filed, because only a signed note exists as a
     * finished document. Allowing it earlier would let somebody mark work
     * complete that a specialist has not put their name to yet, which is the
     * same failure the completeness gate at signing exists to prevent.
     */
    if (!submission.note || (submission.note.state !== "SIGNED" && submission.note.state !== "DELIVERED")) {
      return { error: "Sign the note before marking it filed — there is nothing finished to file yet." };
    }
  }

  await prisma.submission.update({
    where: { id: submission.id },
    data: undo
      ? { processedAt: null, processedById: null, processedNoteVersion: null, processedRef: null }
      : {
          processedAt: new Date(),
          processedById: user.id,
          processedNoteVersion: submission.note?.version ?? null,
          processedRef: reference || null,
        },
  });

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: undo ? "submission.unmarked_processed" : "submission.processed",
    entityType: "submission",
    entityId: submission.id,
    entityLabel: submission.client.clientCode,
    changes: undo
      ? { processed: { from: "yes", to: "no" } }
      : {
          processed: { from: "no", to: "yes" },
          noteVersion: { from: null, to: String(submission.note?.version ?? "") },
          // The reference is recorded because it is the thing that lets someone
          // reconcile against the destination system later. It is not clinical.
          reference: { from: null, to: reference || "(none given)" },
        },
  });

  revalidatePath(`/s/note/${submission.id}`);
  revalidatePath("/s");
  return { ok: true };
}
