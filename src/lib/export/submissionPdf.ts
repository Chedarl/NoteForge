import "server-only";

import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { identityOf } from "@/lib/clients/identity";
import { STATUS_LABEL } from "@/lib/clients/labels";
import { TEMPLATES } from "@/lib/intake/templates";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { safeSegment } from "@/lib/export/zip";
import { summariseChanges, changeHeadline } from "@/lib/export/changes";
import { renderSubmissionPdf, type PdfSection, type SubmissionPdfData } from "@/lib/export/pdf";
import type { SubmissionState, TemplateKind } from "@prisma/client";

/**
 * Assembles one submission into the §5 PDF.
 *
 * Split from `pdf.tsx` deliberately: this half talks to the database, decrypts a
 * name and decides what a reader is allowed to see, and the renderer half is
 * pure. That means the layout can be exercised from a script with a literal
 * object and no database — which is how the page-break and footer behaviour was
 * actually checked — and it keeps decryption out of a file that React renders.
 */

/** How a submission's state reads to someone outside the queue. */
const STATE_LABEL: Record<SubmissionState, string> = {
  RECEIVED: "Received",
  NEEDS_VERIFY: "Awaiting human verification of the transcript",
  QUEUED: "Queued for note production",
  IN_PROGRESS: "Note in production",
  DONE: "Note produced",
  BLOCKED: "Refused — client status",
  SUPERSEDED: "Superseded by a later submission",
};

export interface SubmissionPdfOptions {
  submissionId: string;
  practiceId: string;
  /**
   * Whether the decrypted client name appears in the PDF.
   *
   * Default false, matching the ZIP export. A PDF is more likely than any other
   * artefact here to be emailed, printed or dropped into a model's context
   * window, so the name is an explicit request and is audited separately.
   */
  includeName: boolean;
  /**
   * When set, the submission must either have been recorded by this user or
   * belong to a client they hold. Staff pass nothing and see the whole practice.
   *
   * Applied inside the query rather than checked on the result, so a therapist
   * asking for a colleague's submission gets the same not-found as one asking
   * for an id that does not exist — the convention throughout this codebase, and
   * the reason a probe cannot confirm that a row is there.
   */
  restrictToTherapistId?: string;
}

export interface SubmissionPdfResult {
  pdf: Buffer;
  filename: string;
  clientCode: string;
  encounterDate: string;
  /** True when the bytes carry an identifiable name — drives the audit action. */
  identifiable: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * `[ClientID]_[YYYY-MM-DD]_[EncounterType]_[SubmissionID].pdf`, per §5.
 *
 * Every segment is passed through `safeSegment`, the same guard the ZIP paths
 * use: a client code is practice-supplied text and reaches a `Content-Disposition`
 * header and somebody's filesystem from here. Underscores separate the fields, so
 * any underscore inside a segment is flattened to a hyphen — otherwise a code
 * containing one would silently change how the name parses downstream, and these
 * filenames are meant to be machine-split.
 */
export function submissionPdfFilename(parts: {
  clientCode: string;
  encounterDate: string;
  encounterType: string;
  submissionId: string;
}): string {
  const segment = (value: string) => safeSegment(value).replace(/[\s_]+/g, "-");
  return [
    segment(parts.clientCode),
    segment(parts.encounterDate),
    segment(parts.encounterType),
    segment(parts.submissionId),
  ].join("_") + ".pdf";
}

export async function buildSubmissionPdf(
  options: SubmissionPdfOptions
): Promise<SubmissionPdfResult | null> {
  const { submissionId, practiceId, includeName, restrictToTherapistId } = options;

  // Scoped by practiceId in the same query rather than checked afterwards, so a
  // guessed id from another tenant is a not-found and never a row this code has
  // held in memory.
  const submission = await prisma.submission.findFirst({
    where: {
      id: submissionId,
      practiceId,
      ...(restrictToTherapistId
        ? {
            OR: [
              { submittedById: restrictToTherapistId },
              { client: { primaryTherapistId: restrictToTherapistId } },
            ],
          }
        : {}),
    },
    include: {
      client: true,
      submittedBy: { select: { fullName: true, role: true, discipline: true } },
      pages: { orderBy: { pageNumber: "asc" } },
      flags: { where: { resolution: "OPEN" }, select: { kind: true, detail: true } },
      practice: { select: { name: true } },
    },
  });

  if (!submission) return null;

  const identity = identityOf(submission.client);
  const template = TEMPLATES[submission.templateKind as TemplateKind];
  const raw = (submission.fields ?? {}) as Record<string, unknown>;

  const sections: PdfSection[] = template.fields.map((field) => {
    const value = raw[field.id];
    return {
      label: field.label,
      value: typeof value === "string" && value.trim() ? value.trim() : null,
    };
  });

  const transcript =
    submission.kind === "PHOTO"
      ? submission.pages
          .map((page) => page.verifiedText ?? "")
          .filter((text) => text.trim())
          .join("\n\n") || null
      : null;

  // Read from the submission, which captured it at write time. Falling back to
  // the user's current discipline only when the submission predates the field.
  const discipline = submission.discipline ?? submission.submittedBy.discipline ?? null;

  const changes = await summariseChanges(submission);

  const data: SubmissionPdfData = {
    submissionId: submission.id,
    practiceName: submission.practice.name,

    clientCode: submission.client.clientCode,
    clientName: includeName ? identity.displayName : null,
    initials: submission.client.initials,
    birthYear: submission.client.birthYear,

    clientStatus: STATUS_LABEL[submission.client.status],
    clientStatusSince: iso(submission.client.statusChangedAt),
    clientStatusReason: submission.client.statusReason,

    encounterDate: iso(submission.encounterDate),
    encounterType: template.name,
    discipline: discipline ? DISCIPLINE_LABEL[discipline] : null,
    professional: submission.submittedBy.fullName,
    professionalRole: discipline ? DISCIPLINE_LABEL[discipline] : submission.submittedBy.role,
    source: submission.kind === "PHOTO" ? "photographed" : "typed",
    state: STATE_LABEL[submission.state],
    submittedAt: submission.createdAt.toISOString().slice(0, 16).replace("T", " "),
    handoverDelayDays:
      Math.round(
        ((submission.createdAt.getTime() - submission.encounterDate.getTime()) / 864e5) * 10
      ) / 10,

    sections,
    transcript,
    openFlags: submission.flags.map((flag) => ({ kind: flag.kind, detail: flag.detail })),
    changes,
    changeHeadline: changeHeadline(changes),

    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + "Z",
  };

  const rendered = await renderSubmissionPdf(data);
  const pdf = await attachJson(rendered, machineReadable(data));

  return {
    pdf,
    filename: submissionPdfFilename({
      clientCode: data.clientCode,
      encounterDate: data.encounterDate,
      encounterType: data.encounterType,
      submissionId: data.submissionId,
    }),
    clientCode: data.clientCode,
    encounterDate: data.encounterDate,
    identifiable: data.clientName !== null,
  };
}

/**
 * The machine-readable payload, §5's optional clause.
 *
 * Typed values, ISO dates and explicit nulls — the same contract as
 * `sessions.json` in the ZIP. Sections are keyed by template field id rather
 * than by label, because ids are stable and labels are wording somebody may
 * improve. The printed page uses the labels; anything automated should use this.
 */
function machineReadable(data: SubmissionPdfData): Record<string, unknown> {
  return {
    schema: "noteforge.submission/1",
    submissionId: data.submissionId,
    generatedAt: data.generatedAt,
    client: {
      clientCode: data.clientCode,
      name: data.clientName,
      initials: data.initials,
      birthYear: data.birthYear,
      status: data.clientStatus,
      statusSince: data.clientStatusSince,
      statusReason: data.clientStatusReason,
    },
    encounter: {
      date: data.encounterDate,
      type: data.encounterType,
      discipline: data.discipline,
      professional: data.professional,
      professionalRole: data.professionalRole,
      source: data.source,
      state: data.state,
      submittedAt: data.submittedAt,
      handoverDelayDays: data.handoverDelayDays,
    },
    sections: data.sections.map((section) => ({
      label: section.label,
      value: section.value,
    })),
    transcript: data.transcript,
    openFlags: data.openFlags,
    changesSinceLastSubmission: {
      headline: data.changeHeadline,
      previousSubmission: data.changes.previous,
      daysSincePrevious: data.changes.daysSincePrevious,
      comparable: data.changes.comparable,
      clinicianStatement: data.changes.clinicianStatement,
      fields: data.changes.fields,
    },
    disclaimer:
      "Collected by NoteForge. Source material for a note writer; not a clinical note and not a substitute for clinical judgement.",
  };
}

/**
 * Attaches the JSON to the PDF as an embedded file.
 *
 * An attachment rather than pasted-in text: the printed page stays clean for the
 * human reader (§5 forbids clutter) while a script can pull the structured form
 * out of the same file, so the two can never be separated in transit or drift
 * apart. `@react-pdf/renderer` cannot embed files, and `pdf-lib` can — which is
 * why both libraries are dependencies and why this is a second pass over the
 * rendered bytes rather than part of the render.
 */
async function attachJson(pdf: Buffer, payload: Record<string, unknown>): Promise<Buffer> {
  const doc = await PDFDocument.load(new Uint8Array(pdf));

  doc.attach(new TextEncoder().encode(JSON.stringify(payload, null, 2)), "submission.json", {
    mimeType: "application/json",
    description: "Structured form of this submission, for automated readers.",
    creationDate: new Date(),
    modificationDate: new Date(),
  });

  return Buffer.from(await doc.save());
}
