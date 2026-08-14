import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { sendMail, siteUrl } from "@/lib/email/send";
import { checkClientAcceptsSubmissions, STATUS_LABEL } from "@/lib/clients/guard";
import { contentHash, normalizeForCompare } from "@/lib/dedupe/normalize";
import { detectDuplicates, persistFlags } from "@/lib/dedupe/detect";
import { flattenFields } from "@/lib/intake/templates";
import type { Discipline, SubmissionKind, TemplateKind, User } from "@prisma/client";

/**
 * The door. Every submission in this system comes through here.
 *
 * The order of operations is the whole design and it is not arbitrary:
 *
 *   1. **Guard first, against the database, at write time.** Not against the
 *      form's idea of the status, which was true when the page loaded.
 *   2. **A refusal is still a record.** Blocked submissions are written with
 *      state BLOCKED and a STATUS_BLOCK flag, never discarded. The therapist's
 *      work survives, somebody can reconcile it, and the count becomes the
 *      status-accuracy figure that proves the guardrail is doing something.
 *   3. **Accepted, then examined.** Duplicate detection runs after the row
 *      exists, so a failure in detection can never lose a submission. The worst
 *      case is an unflagged duplicate, which is exactly the status quo.
 */

export interface SubmitInput {
  practiceId: string;
  clientId: string;
  submittedBy: User;
  kind: SubmissionKind;
  templateKind: TemplateKind;
  encounterDate: Date;
  /*
   * `unknown` rather than `string`, because a field's value now depends on its
   * type: prose is a string, a picker is `string[]`, a severity field is an
   * object. Prisma stores it as Json either way; what mattered was that every
   * reader stopped assuming a string, which is what `renderFieldValue` is for.
   */
  fields: Record<string, unknown>;
  /** Free text for a narrative or the notes accompanying a photo set. */
  extraText?: string;
  /**
   * Stamped onto the row rather than joined from the user at read time, so a
   * clinician changing discipline later cannot rewrite what an old encounter
   * was. Falls back to the submitter's current discipline.
   */
  discipline?: Discipline | null;
}

export type SubmitResult =
  | { ok: true; submissionId: string; flagged: boolean; needsVerify: boolean }
  | { ok: false; reason: "not_found" }
  | {
      ok: false;
      reason: "blocked";
      message: string;
      status: string;
      since: Date | undefined;
      submissionId: string;
    };

export async function submitEncounter(input: SubmitInput): Promise<SubmitResult> {
  const { client, verdict } = await checkClientAcceptsSubmissions(
    input.clientId,
    input.practiceId
  );
  if (!client || !verdict) return { ok: false, reason: "not_found" };

  const text = [flattenFields(input.templateKind, input.fields), input.extraText?.trim()]
    .filter(Boolean)
    .join("\n\n");

  const base = {
    practiceId: input.practiceId,
    clientId: client.id,
    submittedById: input.submittedBy.id,
    kind: input.kind,
    templateKind: input.templateKind,
    discipline: input.discipline ?? input.submittedBy.discipline ?? null,
    encounterDate: input.encounterDate,
    // Cast at the single point where answers enter the database, rather than
    // widening the domain type — the shape is validated by the template the
    // caller read the form against.
    fields: input.fields as Prisma.InputJsonObject,
    rawText: text,
    contentHash: contentHash(text),
    normalizedText: normalizeForCompare(text),
  };

  // ── Refused, but recorded ────────────────────────────────────────────────
  if (!verdict.allowed) {
    const blocked = await prisma.submission.create({
      data: { ...base, state: "BLOCKED" },
    });
    await prisma.submissionFlag.create({
      data: {
        submissionId: blocked.id,
        kind: "STATUS_BLOCK",
        detail: `Submitted against a client marked ${STATUS_LABEL[verdict.status]}${
          verdict.since ? ` since ${verdict.since.toISOString().slice(0, 10)}` : ""
        }.`,
      },
    });
    await writeAudit({
      practiceId: input.practiceId,
      actor: input.submittedBy,
      action: "submission.blocked",
      entityType: "submission",
      entityId: blocked.id,
      entityLabel: client.clientCode,
      changes: { clientStatus: { from: null, to: verdict.status } },
    });
    await notifyBlocked(input.practiceId, client.clientCode, verdict.status, input.submittedBy);

    return {
      ok: false,
      reason: "blocked",
      message: verdict.message!,
      status: verdict.status,
      since: verdict.since,
      submissionId: blocked.id,
    };
  }

  // ── Accepted ─────────────────────────────────────────────────────────────
  //
  // A photo submission starts in NEEDS_VERIFY because its text does not exist
  // yet; a structured one is already in the words the clinician chose and goes
  // straight to the queue.
  const needsVerify = input.kind === "PHOTO";

  const submission = await prisma.submission.create({
    data: { ...base, state: needsVerify ? "NEEDS_VERIFY" : "QUEUED" },
  });

  await prisma.client.update({
    where: { id: client.id },
    data: {
      lastEncounterAt:
        !client.lastEncounterAt || client.lastEncounterAt < input.encounterDate
          ? input.encounterDate
          : client.lastEncounterAt,
    },
  });

  await writeAudit({
    practiceId: input.practiceId,
    actor: input.submittedBy,
    action: "submission.created",
    entityType: "submission",
    entityId: submission.id,
    entityLabel: client.clientCode,
  });

  // Structured text can be compared immediately. A photo set has nothing to
  // compare until a human has verified the transcript, so detection is deferred
  // to that moment (see `finishVerification`).
  let flagged = false;
  if (!needsVerify) {
    const outcome = await detectDuplicates(submission);
    await persistFlags(submission.id, outcome);
    flagged = outcome.flags.length > 0;
  }

  return { ok: true, submissionId: submission.id, flagged, needsVerify };
}

/**
 * Runs detection once a photo submission finally has human-verified text.
 *
 * This is why detection is a separate exported function rather than being
 * inlined above: the two intake paths reach comparable text at different
 * moments, and comparing raw OCR would produce noise from the transcription
 * quirks rather than signal about the content.
 */
export async function finishVerification(submissionId: string): Promise<boolean> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { pages: { orderBy: { pageNumber: "asc" } } },
  });
  if (!submission) return false;

  const text = submission.pages
    .map((page) => page.verifiedText ?? "")
    .filter((t) => t.trim())
    .join("\n\n");

  const updated = await prisma.submission.update({
    where: { id: submissionId },
    data: {
      rawText: text,
      contentHash: contentHash(text),
      normalizedText: normalizeForCompare(text),
      state: "QUEUED",
    },
  });

  const outcome = await detectDuplicates(updated);
  await persistFlags(updated.id, outcome);
  return outcome.flags.length > 0;
}

async function notifyBlocked(
  practiceId: string,
  clientCode: string,
  status: string,
  therapist: User
): Promise<void> {
  const staff = await prisma.user.findMany({
    where: { practiceId, status: "ACTIVE", role: { in: ["OWNER", "SPECIALIST"] } },
    select: { email: true },
  });
  // Only OWNER and SPECIALIST are selected above and both always have an
  // address, but the column is nullable since field agents arrived — so this
  // filters rather than asserting, and a practice with no reachable staff
  // simply sends nothing instead of throwing inside a refusal path.
  const addresses = staff.map((s) => s.email).filter((e): e is string => Boolean(e));
  if (addresses.length === 0) return;

  await sendMail({
    to: addresses,
    subject: `NoteForge — submission refused for ${clientCode} (${STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status})`,
    text: [
      `${therapist.fullName} tried to file a note for client ${clientCode}, which is marked ${status}.`,
      "",
      "The submission was kept but not queued. Either the status is out of date or the session predates the change — someone needs to decide which.",
      "",
      `${siteUrl()}/s?tab=blocked`,
    ].join("\n"),
  });
}
