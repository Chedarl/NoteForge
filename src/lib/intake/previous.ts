import "server-only";

import { prisma } from "@/lib/prisma";
import { openJson } from "@/lib/crypto/text";
import { TEMPLATES, encounterTypeOf, renderFieldValue } from "@/lib/intake/templates";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { STATUS_LABEL } from "@/lib/clients/labels";
import type { TemplateKind } from "@prisma/client";

/**
 * What was recorded about this person last time, shown before anything is typed.
 *
 * The client called the historical comparison "one of the highest-value
 * features", and the half that existed was the wrong half: the specialist
 * workspace showed previous notes beside the source, so the comparison was
 * available to the person writing the note and to nobody at the moment it
 * changes what gets written.
 *
 * A clinician who cannot see that the last risk assessment was "active, with
 * plan" writes a note that reads as though nothing happened. One who cannot see
 * the current medication writes "no change" without knowing what it is a change
 * from. This is the screen where knowing costs nothing and not knowing is
 * expensive.
 *
 * ## What it deliberately does not do
 *
 * It does not pre-fill anything. Carrying an answer forward would turn "what is
 * true today" into "what was true last time unless somebody noticed" — and a
 * medication list that copies itself forward is exactly how a stopped drug
 * stays in a record for a year. The clinician reads it and types their own.
 *
 * It also does not interpret. No "risk has increased", no "this client is
 * deteriorating". It reports what was written and when, and the reading is the
 * clinician's, per §6.
 */

export interface PreviousFact {
  /** The template's own label, so the two screens name things identically. */
  label: string;
  value: string;
}

export interface PreviousSummary {
  submissionId: string;
  /** ISO day. The encounter's date, never when it was uploaded. */
  encounterDate: string;
  daysSince: number;
  templateName: string;
  encounterType: string;
  submittedBy: string;
  discipline: string | null;
  /** Where the client stood at the time, which may not be where they stand now. */
  clientStatus: string;
  /** Their own account of what had changed, if the template carried one. */
  clinicianStatement: string | null;
  /**
   * The handful worth reading before writing. Ordered as the template orders
   * them, so a nurse practitioner reads risk before plan exactly as they filled
   * it in.
   */
  facts: PreviousFact[];
  /** True when there is more in the submission than the facts shown. */
  truncated: boolean;
}

/**
 * The fields worth surfacing, per template.
 *
 * A deliberately short list rather than everything. The whole value is that it
 * can be read in the two seconds before someone starts typing; a full replay of
 * the last encounter is a wall of text that gets scrolled past, which is the
 * same as not showing it.
 */
const HIGHLIGHTS: Partial<Record<TemplateKind, string[]>> = {
  NURSING: ["riskSuicidal", "riskSelfHarm", "riskSubstance", "medication", "plan"],
  CASE_MANAGEMENT: ["needsList", "housing", "goalProgress", "referrals", "plan"],
  SOAP: ["assessment", "plan"],
  DAP: ["assessment", "plan"],
  BIRP: ["response", "plan"],
  NARRATIVE: ["narrative"],
};

/** How much of a long answer is worth showing here. */
const MAX_VALUE_CHARS = 220;

export async function previousSubmissionFor(args: {
  practiceId: string;
  clientId: string;
  /** Set for a therapist, so they see only their own or their clients' history. */
  restrictToTherapistId?: string;
  /** Excluded when re-opening an existing submission, so it does not describe itself. */
  excludeSubmissionId?: string;
}): Promise<PreviousSummary | null> {
  const previous = await prisma.submission.findFirst({
    where: {
      practiceId: args.practiceId,
      clientId: args.clientId,
      ...(args.excludeSubmissionId ? { id: { not: args.excludeSubmissionId } } : {}),
      /*
       * The same exclusions the export's comparison uses, for the same reasons.
       * A BLOCKED submission was refused on client status and never entered the
       * record; a SUPERSEDED one was resolved as a duplicate of another. Neither
       * is a prior encounter, and showing one as "last time" would tell a
       * clinician something that is not true.
       *
       * AWAITING_REVIEW is excluded too: a field worker's account that no
       * clinician has read yet is not established history.
       */
      state: { notIn: ["BLOCKED", "SUPERSEDED", "AWAITING_REVIEW"] },
      ...(args.restrictToTherapistId
        ? {
            OR: [
              { submittedById: args.restrictToTherapistId },
              { client: { primaryTherapistId: args.restrictToTherapistId } },
            ],
          }
        : {}),
    },
    // By when the encounter happened, not when it arrived. Handover runs late
    // routinely, and ordering by `createdAt` would call a session from the 4th
    // "the last one" because it was uploaded after one from the 9th.
    orderBy: { encounterDate: "desc" },
    include: {
      submittedBy: { select: { fullName: true, discipline: true } },
      client: { select: { status: true } },
    },
  });

  if (!previous) return null;

  const kind = previous.templateKind as TemplateKind;
  const template = TEMPLATES[kind];
  const raw = openJson(previous.fieldsEnc);

  const wanted = HIGHLIGHTS[kind] ?? [];
  const facts: PreviousFact[] = [];
  for (const id of wanted) {
    const field = template.fields.find((f) => f.id === id);
    if (!field) continue;
    const rendered = renderFieldValue(raw[id], field).trim();
    // An unanswered field is left out entirely rather than shown as empty.
    // "Medication: —" reads as "no medication", which is a different claim.
    if (!rendered) continue;
    facts.push({
      label: field.label,
      value:
        rendered.length > MAX_VALUE_CHARS
          ? `${rendered.slice(0, MAX_VALUE_CHARS - 1).trimEnd()}…`
          : rendered,
    });
  }

  const statementField = template.fields.find((f) => f.id === "sinceLastContact");
  const clinicianStatement = statementField
    ? renderFieldValue(raw.sinceLastContact, statementField).trim() || null
    : null;

  const discipline = previous.discipline ?? previous.submittedBy.discipline ?? null;
  const encounterDate = previous.encounterDate.toISOString().slice(0, 10);

  return {
    submissionId: previous.id,
    encounterDate,
    daysSince: Math.max(
      0,
      Math.round((Date.now() - previous.encounterDate.getTime()) / 864e5)
    ),
    templateName: template.name,
    encounterType: encounterTypeOf(kind, raw),
    submittedBy: previous.submittedBy.fullName,
    discipline: discipline ? DISCIPLINE_LABEL[discipline] : null,
    clientStatus: STATUS_LABEL[previous.client.status],
    clinicianStatement,
    facts,
    truncated: facts.length < Object.keys(raw).filter((k) => raw[k]).length,
  };
}
