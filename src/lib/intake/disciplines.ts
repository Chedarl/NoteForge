import type { Discipline, TemplateKind } from "@prisma/client";

/**
 * Who is submitting, and what that means for what gets collected.
 *
 * NoteForge does not write the notes — the material collected here is exported
 * and the notes are written downstream. That makes this file more important
 * than it looks: whatever writes those notes can only work with what was
 * *asked for* at intake, and a nurse practitioner's encounter and a social case
 * worker's encounter need different things asked.
 *
 * So discipline does two jobs. It selects the templates a clinician is offered,
 * so the right fields exist. And it is stamped on every submission and carried
 * into every export, so the thing writing the note knows which kind of note it
 * is writing without having to guess from the prose.
 *
 * Client-safe: no server-only imports, because the intake form needs this.
 */

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  RECOVERY_COACH: "Recovery Coach",
  SOCIAL_CASE_WORKER: "Social Case Worker",
  NURSE_PRACTITIONER: "Nurse Practitioner",
  THERAPIST: "Therapist",
  COUNSELLOR: "Counsellor",
  OTHER: "Other",
};

export const DISCIPLINE_HINT: Record<Discipline, string> = {
  RECOVERY_COACH:
    "Contact in the field — how the person presented, what was needed, what was done, and anything that has changed.",
  SOCIAL_CASE_WORKER:
    "Case management and psychosocial support — needs, actions taken, referrals, benefits and housing.",
  NURSE_PRACTITIONER:
    "Clinical nursing encounters — presentation, measures and observations, medication, assessment and plan.",
  THERAPIST: "Psychotherapy sessions — SOAP, DAP or BIRP.",
  COUNSELLOR: "Counselling sessions — SOAP, DAP, BIRP or a narrative account.",
  OTHER: "Every template is available.",
};

export const DISCIPLINE_OPTIONS: Discipline[] = [
  "RECOVERY_COACH",
  "SOCIAL_CASE_WORKER",
  "NURSE_PRACTITIONER",
  "THERAPIST",
  "COUNSELLOR",
  "OTHER",
];

/**
 * Which templates each discipline sees, most appropriate first.
 *
 * Nobody is *restricted* to their discipline's template — a nurse practitioner
 * running a therapeutic session should be able to pick BIRP. The ordering puts
 * the right one first and leaves the judgement with the clinician, which is
 * where clinical judgement belongs.
 */
export const TEMPLATES_FOR_DISCIPLINE: Record<Discipline, TemplateKind[]> = {
  // A field contact is written as prose, not as a structured assessment. A
  // coach standing outside somebody's house is recording what happened, and
  // asking them to pick a template first is how the update never gets filed.
  RECOVERY_COACH: ["NARRATIVE", "CASE_MANAGEMENT"],
  SOCIAL_CASE_WORKER: ["CASE_MANAGEMENT", "NARRATIVE", "SOAP", "DAP"],
  NURSE_PRACTITIONER: ["NURSING", "SOAP", "NARRATIVE", "DAP"],
  THERAPIST: ["SOAP", "DAP", "BIRP", "NARRATIVE"],
  COUNSELLOR: ["SOAP", "DAP", "BIRP", "NARRATIVE"],
  OTHER: ["SOAP", "DAP", "BIRP", "NARRATIVE", "CASE_MANAGEMENT", "NURSING"],
};

export function templatesFor(discipline: Discipline | null): TemplateKind[] {
  if (!discipline) return TEMPLATES_FOR_DISCIPLINE.OTHER;
  return TEMPLATES_FOR_DISCIPLINE[discipline];
}
