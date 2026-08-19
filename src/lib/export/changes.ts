import "server-only";

import { prisma } from "@/lib/prisma";
import { TEMPLATES, renderFieldValue } from "@/lib/intake/templates";
import { openJson } from "@/lib/crypto/text";
import { cleanText } from "@/lib/dedupe/normalize";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import type { Submission, TemplateKind } from "@prisma/client";

/**
 * "What has changed since the last submission."
 *
 * `docs/REQUIREMENTS.md` §5 requires the PDF to carry this as a called-out
 * section, and §4 calls the comparison one of the highest-value features in the
 * product. This module answers it for one submission, by looking backwards at
 * the previous one for the same client.
 *
 * Three deliberate limits, because this is a comparison and not an opinion:
 *
 * **It reports movement, never meaning.** A field is added, changed, unchanged
 * or no longer recorded. It does not say a client deteriorated, improved, or
 * that a change matters — that is the reader's judgement and the platform does
 * not have standing to pre-empt it (§6).
 *
 * **Comparison is whitespace- and punctuation-insensitive, nothing more.** Two
 * values match when `cleanText` makes them equal, so re-typing the same sentence
 * with different capitalisation is not a change. It stops short of stemming or
 * token overlap: a field edited from "no change" to "no changes" is genuinely
 * the same, but a field edited from "denies SI" to "denies SI, plan in place" is
 * genuinely different, and only exact-after-cleaning tells those apart reliably.
 *
 * **Different templates are not diffed field by field.** A nursing encounter
 * following a case-management one shares no field ids, so every field would read
 * "added" and the section would be noise. The summary says the shape changed and
 * leaves the two side by side.
 *
 * **The clinician's own sentence comes first.** The §3 "what has changed since
 * last contact" field is read straight off the submission as
 * `clinicianStatement`; the derived comparison sits under it. That field is
 * then excluded from the field-by-field list, because a field whose whole
 * purpose is to say what is different would read "changed" every single time
 * and would be arguing with the sentence printed above it.
 */

export type FieldChangeStatus = "added" | "changed" | "unchanged" | "cleared";

export interface FieldChange {
  fieldId: string;
  /** The template's label, so the PDF prints identical labels every time. */
  label: string;
  status: FieldChangeStatus;
}

export interface PreviousSubmission {
  id: string;
  sessionDate: string;
  template: string;
  templateCode: TemplateKind;
  submittedBy: string;
  discipline: string | null;
}

export interface ChangeSummary {
  /** Null when this is the first submission recorded for the client. */
  previous: PreviousSubmission | null;
  /** Whole days between the two encounter dates. Null when there is no previous. */
  daysSincePrevious: number | null;
  /** False when the previous submission used a different template. */
  comparable: boolean;
  /** Per-field movement, in template order. Empty when not comparable. */
  fields: FieldChange[];
  /**
   * The clinician's own statement of what changed, from the template's
   * `sinceLastContact` field. Null on a template that does not carry it — the
   * one-box narrative — and on anything submitted before it existed. The PDF
   * renders the derived comparison either way.
   */
  clinicianStatement: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The field id carrying the clinician's own account of what has changed. */
const STATEMENT_FIELD = "sinceLastContact";

/**
 * The clinician's sentence, or null.
 *
 * Read through `renderFieldValue` like everything else rather than with a
 * `typeof === "string"` check, so that if this field ever stops being prose it
 * does not silently start returning null.
 */
function statementOf(raw: unknown, kind: TemplateKind): string | null {
  const field = TEMPLATES[kind].fields.find((f) => f.id === STATEMENT_FIELD);
  if (!field) return null;
  const source = (raw ?? {}) as Record<string, unknown>;
  const rendered = renderFieldValue(source[field.id], field).trim();
  return rendered || null;
}

/** Equal after case, punctuation and whitespace are normalised away. */
function sameValue(a: string, b: string): boolean {
  return cleanText(a) === cleanText(b);
}

/**
 * Every answer as comparable text, whatever shape it was stored in.
 *
 * This dropped non-strings, which meant a client going from three needs to
 * seven reported "unchanged" — the comparison that makes the picker worth
 * having, reporting the opposite of the truth. Rendering through the shared
 * helper means a set change reads as a change.
 *
 * It compares the rendered form rather than the set itself, so re-ordering the
 * same selections still reads as unchanged: `labelsForNeeds` emits them in list
 * order rather than click order for exactly this reason.
 */
function stringFields(raw: unknown, kind: TemplateKind): Record<string, string> {
  const out: Record<string, string> = {};
  const source = (raw ?? {}) as Record<string, unknown>;
  // Keyed by the template's own fields so option ids resolve to labels — a
  // change reported as "housing → housing, food" rather than as raw slugs.
  const byId = new Map(TEMPLATES[kind].fields.map((f) => [f.id, f]));
  for (const [key, value] of Object.entries(source)) {
    const rendered = renderFieldValue(value, byId.get(key));
    if (rendered) out[key] = rendered;
  }
  return out;
}

/**
 * The previous submission is the one with the closest *earlier* encounter date,
 * not the one created most recently.
 *
 * Those differ whenever handover runs late, which it routinely does — a session
 * from the 4th photographed and uploaded on the 12th arrives after one from the
 * 9th. Ordering by `createdAt` would compare a session against one that happened
 * after it and report the changes backwards.
 *
 * `SUPERSEDED` rows are excluded because a submission resolved as a duplicate of
 * another is not a distinct prior encounter. `BLOCKED` rows are excluded because
 * they were refused on client status and never entered the record.
 */
export async function summariseChanges(
  submission: Pick<
    Submission,
    "id" | "clientId" | "practiceId" | "encounterDate" | "templateKind" | "fieldsEnc"
  >
): Promise<ChangeSummary> {
  const statement = statementOf(openJson(submission.fieldsEnc), submission.templateKind as TemplateKind);

  const previous = await prisma.submission.findFirst({
    where: {
      practiceId: submission.practiceId,
      clientId: submission.clientId,
      id: { not: submission.id },
      encounterDate: { lt: submission.encounterDate },
      state: { notIn: ["SUPERSEDED", "BLOCKED"] },
    },
    orderBy: { encounterDate: "desc" },
    include: { submittedBy: { select: { fullName: true, discipline: true } } },
  });

  if (!previous) {
    return {
      previous: null,
      daysSincePrevious: null,
      comparable: false,
      fields: [],
      clinicianStatement: statement,
    };
  }

  const discipline = previous.discipline ?? previous.submittedBy.discipline ?? null;
  const previousRecord: PreviousSubmission = {
    id: previous.id,
    sessionDate: iso(previous.encounterDate),
    template: TEMPLATES[previous.templateKind as TemplateKind].name,
    templateCode: previous.templateKind as TemplateKind,
    submittedBy: previous.submittedBy.fullName,
    discipline: discipline ? DISCIPLINE_LABEL[discipline] : null,
  };

  const daysSincePrevious = Math.round(
    (submission.encounterDate.getTime() - previous.encounterDate.getTime()) / 864e5
  );

  const comparable = previous.templateKind === submission.templateKind;
  if (!comparable) {
    return {
      previous: previousRecord,
      daysSincePrevious,
      comparable: false,
      fields: [],
      clinicianStatement: statement,
    };
  }

  // Both sides are read against the *current* submission's template. The
  // `comparable` gate above has already established they share one.
  const kind = submission.templateKind as TemplateKind;
  const now = stringFields(openJson(submission.fieldsEnc), kind);
  const before = stringFields(openJson(previous.fieldsEnc), kind);

  const fields: FieldChange[] = TEMPLATES[submission.templateKind as TemplateKind].fields
    .filter((field) => !field.excludeFromComparison)
    .map((field) => {
      const current = now[field.id];
      const prior = before[field.id];

      let status: FieldChangeStatus;
      if (current && !prior) status = "added";
      else if (!current && prior) status = "cleared";
      else if (current && prior) status = sameValue(current, prior) ? "unchanged" : "changed";
      // Absent from both: nothing was recorded either time, which is not movement.
      else status = "unchanged";

      return { fieldId: field.id, label: field.label, status };
    });

  return {
    previous: previousRecord,
    daysSincePrevious,
    comparable: true,
    fields,
    clinicianStatement: statement,
  };
}

/** The one-line summary printed under the section heading. */
export function changeHeadline(summary: ChangeSummary): string {
  if (!summary.previous) {
    return "First submission recorded for this client. There is nothing to compare against.";
  }

  const gap =
    summary.daysSincePrevious === null
      ? ""
      : summary.daysSincePrevious === 0
        ? " on the same day"
        : ` ${summary.daysSincePrevious} day${summary.daysSincePrevious === 1 ? "" : "s"} earlier`;

  if (!summary.comparable) {
    return `Previous submission was a ${summary.previous.template} encounter${gap}. Different template, so the sections do not correspond and are not compared field by field.`;
  }

  const moved = summary.fields.filter((f) => f.status !== "unchanged");
  if (moved.length === 0) {
    return `No section changed since the ${summary.previous.template} submission${gap}. Confirm this is a distinct encounter and not a duplicate handover.`;
  }

  return `${moved.length} of ${summary.fields.length} section${summary.fields.length === 1 ? "" : "s"} changed since the ${summary.previous.template} submission${gap}.`;
}
