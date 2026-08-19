import type { TemplateKind } from "@prisma/client";
import { labelsForNeeds } from "@/lib/intake/needs";

/**
 * The note templates, defined once and used in four places: the therapist's
 * intake form, the completeness gate at intake, the specialist's note editor,
 * and the completeness gate before signing.
 *
 * Keeping them in one structure is what makes "required" mean the same thing in
 * all four. A field that is required in the editor but optional in the form is
 * how a note reaches sign-off with a hole in it, and the specialist discovers at
 * the last step that they need to go back to the therapist.
 *
 * Nothing here is clinical guidance. SOAP, DAP and BIRP are the shapes practices
 * already use; NoteForge does not invent a house format, because a practice that
 * has to change how it documents will simply not adopt this.
 */

/**
 * What kind of control a field is, and therefore what shape its value has.
 *
 * Added because every field used to be a textarea, which is the wrong control
 * for "which of these fifteen things apply" — and because a picker's value is
 * an array, which several places in this codebase quietly assumed could never
 * happen. See the note on `flattenFields` below for the worst of them.
 *
 *  - `prose`    a textarea. The default, and every pre-existing field.
 *  - `choice`   one of a fixed set. Value is a string.
 *  - `multi`    any number of a fixed set. **Value is `string[]`.**
 *  - `severity` a graded answer with a note beside it. Value is
 *               `{ level: string; note: string }`.
 */
export type FieldType = "prose" | "choice" | "multi" | "severity";

/** Below this, a prose answer is a placeholder rather than a record. */
const MIN_MEANINGFUL_CHARS = 8;

/**
 * The date the §3 role-specific field sets landed.
 *
 * Any field made `required` from that day carries this in `since`, and
 * `assessCompleteness` then only demands it of encounters on or after it. See
 * the note on `since` in `TemplateField` for why that matters.
 */
const SECTION_3 = "2026-08-18";

export interface FieldOption {
  id: string;
  label: string;
}

export interface TemplateField {
  id: string;
  label: string;
  /** One line under the label. The difference between a filled field and a good one. */
  hint: string;
  required: boolean;
  rows: number;
  /** Absent means `prose`, so every template written before this existed is unchanged. */
  type?: FieldType;
  /** Required for `choice` and `severity`; `multi` may instead source its own. */
  options?: FieldOption[];
  /**
   * A `multi` field whose options are not fixed in code — today only the
   * psychosocial needs list, which is a standard spine plus whatever the
   * practice has added. The renderer is handed the resolved list.
   */
  optionSource?: "needs";
  /**
   * Groups this field with the run of fields around it under one collapsible
   * heading. **Consecutive** fields sharing a value are one section, so the
   * grouping is the field order rather than a second list to keep in step with
   * it. A field with no section renders bare, which is why SOAP, DAP, BIRP and
   * NARRATIVE look exactly as they always have.
   */
  section?: string;
  /**
   * Required only for encounters on or after this date (ISO `yyyy-mm-dd`).
   *
   * Without this, making a field required reaches backwards over every
   * submission already in the database: the mean-completeness figure on the
   * insights dashboard drops overnight and reads as a collapse in data quality,
   * and the sign-off gate refuses an already-submitted encounter until somebody
   * fills in a field the clinician was never shown. This is the cheap form of
   * the "structured, versioned" the specification asks for — cheap enough that
   * there is no excuse for adding a required field without it.
   *
   * Ignored entirely when `required` is false.
   */
  since?: string;
  /**
   * Kept out of the derived field-by-field comparison in
   * `src/lib/export/changes.ts`.
   *
   * For exactly one field so far: "what has changed since last contact". A
   * field whose entire purpose is to say what is different reads "changed" on
   * every single submission, and it is already printed above the comparison as
   * the clinician's own statement — listing it underneath would be the section
   * arguing with itself.
   */
  excludeFromComparison?: boolean;
}

/** Narrowing helper, so callers stop repeating the `?? "prose"` default. */
export function fieldType(field: TemplateField): FieldType {
  return field.type ?? "prose";
}

/** The shape a `severity` field stores. */
export interface SeverityValue {
  level: string;
  note: string;
}

export function isSeverityValue(value: unknown): value is SeverityValue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.level === "string" && typeof v.note === "string";
}

/**
 * Reads one field out of a submitted form, in the shape its type says.
 *
 * Lives here rather than in each action because there are now three places that
 * turn a form into stored answers — intake, the quick paths, and the note
 * editor — and a picker read with `formData.get` silently keeps only the first
 * ticked box. That is not a crash; it is four of a client's five needs quietly
 * disappearing between the form and the record.
 */
export function readField(field: TemplateField, form: FormData): unknown {
  switch (fieldType(field)) {
    case "multi":
      // `getAll`, because a checkbox group posts its name once per tick and
      // `get` would return only the first.
      return form
        .getAll(field.id)
        .map((v) => String(v).trim())
        .filter(Boolean);
    case "severity":
      return {
        level: String(form.get(`${field.id}__level`) ?? "").trim(),
        note: String(form.get(`${field.id}__note`) ?? "").trim(),
      } satisfies SeverityValue;
    case "choice":
    case "prose":
    default:
      return String(form.get(field.id) ?? "").trim();
  }
}

/**
 * One field's answer as a person would read it.
 *
 * Every export, hash and comparison in this product ultimately wants a string,
 * and before field types existed they each did their own `typeof value ===
 * "string"` check. That is exactly how an array would have disappeared from the
 * ZIP, the PDF and the dedupe hash independently, in three different ways. One
 * function now, used by all of them.
 *
 * Returns an empty string for "nothing recorded", so callers keep their
 * existing falsy checks.
 */
export function renderFieldValue(value: unknown, field?: TemplateField): string {
  if (typeof value === "string") {
    // A `choice` stores an option id; a note writer should not be reading ids.
    const option = field?.options?.find((o) => o.id === value.trim());
    return option ? option.label : value.trim();
  }
  if (Array.isArray(value)) {
    const ids = value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
    /*
     * Ids become labels here, not at the form.
     *
     * What is stored is `["housing", "identification"]`, because ids are what
     * survive a label being reworded. What a note writer opening the export
     * needs to read is "Housing, Identification and documents". Resolving at
     * render time gets both — and it is why the standard vocabulary is a
     * client-safe constant rather than database rows.
     */
    if (field?.optionSource === "needs") return labelsForNeeds(ids).join(", ");
    if (field?.options) {
      return ids
        .map((id) => field.options?.find((o) => o.id === id)?.label ?? id)
        .join(", ");
    }
    return ids.join(", ");
  }
  if (isSeverityValue(value)) {
    const levelId = value.level.trim();
    const level = field?.options?.find((o) => o.id === levelId)?.label ?? levelId;
    const note = value.note.trim();
    if (!level && !note) return "";
    return note ? `${level} — ${note}` : level;
  }
  return "";
}

/**
 * Whether a field has been answered at all.
 *
 * Separate from `renderFieldValue` being non-empty because the thresholds
 * differ by control. Eight characters is a sensible floor for prose and
 * meaningless everywhere else: one tick is a complete answer to a picker, and
 * "Crisis" is a complete answer to a dropdown — gating a `choice` on prose
 * length would have made the encounter-type field permanently incomplete, which
 * blocks signing the note and not merely the form.
 */
export function hasAnswer(value: unknown, field?: TemplateField): boolean {
  if (Array.isArray(value)) return value.some((i) => typeof i === "string" && i.trim());
  if (isSeverityValue(value)) return value.level.trim().length > 0;
  if (typeof value === "string") {
    const text = value.trim();
    // A dropdown's answer is an option id, and ids are short by design.
    if (field && fieldType(field) === "choice") return text.length > 0;
    return text.length >= MIN_MEANINGFUL_CHARS;
  }
  return false;
}

export interface Template {
  kind: TemplateKind;
  name: string;
  description: string;
  fields: TemplateField[];
}

/**
 * The common header the specification puts on every encounter that has a form.
 *
 * Held in the `fields` JSON rather than as columns on `Submission`. Nothing
 * queries or sorts by them, every consumer already reads that JSON, and a
 * column would need a default for the paths that collect no header at all —
 * which would mean inventing an encounter type for a submission nobody typed
 * one into.
 *
 * **`NARRATIVE` deliberately does not get this.** It is the template behind the
 * one-box quick update and the field worker's link, neither of which renders a
 * form: they post a single narrative and nothing else. Three "Not recorded"
 * lines on every quick update the note writer reads would buy nothing.
 */
function commonHeader(section: string): TemplateField[] {
  return [
    {
      id: "encounterType",
      label: "Type of encounter",
      hint: "What kind of contact this was. It becomes part of the exported filename, so a note writer can sort a folder by it.",
      required: true,
      since: SECTION_3,
      rows: 0,
      type: "choice",
      section,
      options: [
        { id: "case_management", label: "Social case management update" },
        { id: "nursing", label: "Nursing" },
        { id: "clinical_follow_up", label: "Clinical follow-up" },
        { id: "psych_evaluation", label: "Psych evaluation" },
        { id: "psych_follow_up", label: "Psych follow-up" },
        { id: "therapy_session", label: "Therapy session" },
        { id: "crisis", label: "Crisis" },
        { id: "other", label: "Other" },
      ],
    },
    {
      id: "modality",
      label: "Where and how",
      hint: "A phone call and a home visit produce very different notes, and the note writer cannot tell which it was from the text.",
      required: true,
      since: SECTION_3,
      rows: 0,
      type: "choice",
      section,
      options: [
        { id: "in_person", label: "In person" },
        { id: "home_visit", label: "Home visit" },
        { id: "telehealth", label: "Telehealth" },
        { id: "phone", label: "Phone" },
      ],
    },
    {
      /*
       * A dropdown rather than a number box, and optional.
       *
       * A number input is a keyboard on a phone, which is the tax this product
       * exists to remove. And a clinician who did not time the contact must not
       * be pushed into inventing a figure — a made-up duration on a billable
       * record is worse than an absent one.
       */
      id: "durationMinutes",
      label: "How long",
      hint: "Roughly. Leave it if you did not time it.",
      required: false,
      rows: 0,
      type: "choice",
      section,
      options: [
        { id: "10", label: "10 minutes" },
        { id: "15", label: "15 minutes" },
        { id: "20", label: "20 minutes" },
        { id: "30", label: "30 minutes" },
        { id: "45", label: "45 minutes" },
        { id: "60", label: "1 hour" },
        { id: "90", label: "1 hour 30" },
      ],
    },
  ];
}

/**
 * "What has changed since last contact", the specification's one required
 * shared section.
 *
 * This is the field the exported PDF prints at the top of its comparison, as
 * `ChangeSummary.clinicianStatement` — the clinician's own account first, and
 * the derived field-by-field movement underneath it. Which is also why it is
 * kept out of that derived list: see `excludeFromComparison`.
 */
function sinceLastContact(section: string, required: boolean): TemplateField {
  return {
    id: "sinceLastContact",
    label: "What has changed since last contact",
    hint: "The one thing a reader should know before anything else. Write 'nothing has changed' if that is the truth — that is a finding too.",
    required,
    ...(required ? { since: SECTION_3 } : {}),
    rows: 3,
    section,
    excludeFromComparison: true,
  };
}

/** The graded scale shared by the three self-directed and outward risk fields. */
const RISK_LEVELS: FieldOption[] = [
  { id: "none", label: "None reported" },
  { id: "passive", label: "Passive" },
  { id: "active_no_plan", label: "Active, no plan" },
  { id: "active_with_plan", label: "Active, with plan or intent" },
];

export const TEMPLATES: Record<TemplateKind, Template> = {
  SOAP: {
    kind: "SOAP",
    name: "SOAP",
    description: "Subjective, Objective, Assessment, Plan.",
    fields: [
      ...commonHeader("This session"),
      sinceLastContact("This session", false),
      {
        id: "subjective",
        label: "Subjective",
        hint: "What the client reported, in their framing.",
        required: true,
        rows: 5,
        section: "The session",
      },
      {
        id: "objective",
        label: "Objective",
        hint: "What you observed — presentation, affect, engagement, any measures taken.",
        required: true,
        rows: 4,
        section: "The session",
      },
      {
        id: "assessment",
        label: "Assessment",
        hint: "Your clinical impression and how it relates to the formulation.",
        required: true,
        rows: 4,
        section: "The session",
      },
      {
        id: "plan",
        label: "Plan",
        hint: "Next steps, homework, referrals, and when you are seeing them again.",
        required: true,
        rows: 4,
        section: "The session",
      },
    ],
  },
  DAP: {
    kind: "DAP",
    name: "DAP",
    description: "Data, Assessment, Plan.",
    fields: [
      ...commonHeader("This session"),
      sinceLastContact("This session", false),
      {
        id: "data",
        label: "Data",
        hint: "Reported and observed, together.",
        required: true,
        rows: 6,
        section: "The session",
      },
      {
        id: "assessment",
        label: "Assessment",
        hint: "Your interpretation of the data above.",
        required: true,
        rows: 4,
        section: "The session",
      },
      {
        id: "plan",
        label: "Plan",
        hint: "Next steps and next appointment.",
        required: true,
        rows: 4,
        section: "The session",
      },
    ],
  },
  BIRP: {
    kind: "BIRP",
    name: "BIRP",
    description: "Behaviour, Intervention, Response, Plan.",
    fields: [
      ...commonHeader("This session"),
      sinceLastContact("This session", false),
      {
        id: "behaviour",
        label: "Behaviour",
        hint: "Presenting behaviour and reported experience this session.",
        required: true,
        rows: 4,
        section: "The session",
      },
      {
        id: "intervention",
        label: "Intervention",
        hint: "What you did — modality, technique, focus.",
        required: true,
        rows: 4,
        section: "The session",
      },
      {
        id: "response",
        label: "Response",
        hint: "How the client responded to the intervention.",
        required: true,
        rows: 4,
        section: "The session",
      },
      {
        id: "plan",
        label: "Plan",
        hint: "Next steps and next appointment.",
        required: true,
        rows: 4,
        section: "The session",
      },
    ],
  },

  /**
   * One box, and it stays one box.
   *
   * This is the template behind the one-box quick update at `/t/write` and the
   * field worker's link at `/f/[token]`, both of which post a single narrative
   * with no form around it. It gets no common header and no sections for that
   * reason — see the note on `commonHeader`.
   */
  NARRATIVE: {
    kind: "NARRATIVE",
    name: "Narrative",
    description: "One free-text account. Use when the session does not fit a grid.",
    fields: [
      {
        id: "narrative",
        label: "Session account",
        hint: "The session as you would describe it. Include risk and plan explicitly.",
        required: true,
        rows: 12,
      },
    ],
  },

  /**
   * Situation, Intervention, Response, Plan.
   *
   * The shape the practice's own case-management notes are actually written in
   * — the samples supplied cover both telehealth and in-person community
   * contacts, and every one of them is these four headings in this order.
   *
   * It exists because a generated note in the wrong shape is a note a reviewer
   * rewrites by hand, which is the work this product is supposed to remove. The
   * §5 PDF, the Word export and the note editor all read templates generically,
   * so adding the shape is enough to make every one of them produce it.
   *
   * Deliberately four prose fields and no pickers. The samples are continuous
   * narrative of 80–150 words a section: a picker would produce a note that does
   * not look like the ones a reviewer has been reading for years, which is the
   * only thing this template is for. The header fields sit above them so the
   * encounter type still names the file and the modality is on the record —
   * telehealth versus in-person is the first thing these notes state.
   */
  SIRP: {
    kind: "SIRP",
    name: "Situation, intervention, response, plan",
    description:
      "The four-part case management note: what was happening, what you did, how they responded, what is next.",
    fields: [
      ...commonHeader("This contact"),
      {
        id: "situation",
        label: "Situation",
        hint: "Why you met and what state things were in. Name the barrier that is still live — what has improved, and what is still getting in the way.",
        required: true,
        rows: 5,
        section: "The contact",
      },
      {
        id: "intervention",
        label: "Intervention",
        hint: "What you actually did, in order. Where you met them, what you reviewed, what you asked them to practise, and how you redirected when it did not land the first time.",
        required: true,
        rows: 8,
        section: "The contact",
      },
      {
        id: "response",
        label: "Response",
        hint: "What they said and did in reply — including the part that did not work. A response that reports only success is one nobody downstream believes.",
        required: true,
        rows: 5,
        section: "The contact",
      },
      {
        id: "plan",
        label: "Plan",
        hint: "What you and they will do next session. One concrete thing, not a restatement of the goal.",
        required: true,
        rows: 3,
        section: "The contact",
      },
    ],
  },

  /**
   * Social case work.
   *
   * Built around what a case management note has to be able to evidence:
   * what the situation is, what was done about it, who else is now involved,
   * and when it is next being looked at. "Actions taken" is required and
   * separate from "plan" on purpose — a case note that records intentions but
   * not actions cannot demonstrate that anything happened.
   *
   * The sections follow the specification's Social Case Worker list. They are
   * in the order a contact actually happens in, not the order the specification
   * lists them: what changed, then what the situation is, then what was done.
   * A form that opens by asking for a benefits status is a form filled in
   * afterwards from memory.
   */
  CASE_MANAGEMENT: {
    kind: "CASE_MANAGEMENT",
    name: "Case management",
    description: "Situation, needs, safety, actions taken, referrals, plan.",
    fields: [
      ...commonHeader("This contact"),
      sinceLastContact("This contact", true),
      {
        id: "presentation",
        label: "How they presented",
        hint: "Mood, appearance, and how engaged they were with you today. Note it if they were hard to reach or did not want to talk.",
        required: false,
        rows: 3,
        section: "This contact",
      },
      {
        /*
         * A dropdown, because housing is the single fact most often asked of a
         * case record and the one most often buried in a paragraph. Six states
         * a worker can answer without thinking; the paragraph below carries
         * everything the six cannot.
         */
        id: "housing",
        label: "Housing right now",
        hint: "Where they are actually sleeping, not where they are registered.",
        required: false,
        rows: 0,
        type: "choice",
        section: "Situation",
        options: [
          { id: "stable", label: "Stable tenancy" },
          { id: "at_risk", label: "At risk of losing it" },
          { id: "temporary", label: "Temporary — sofa-surfing or staying with others" },
          { id: "shelter", label: "Shelter or emergency accommodation" },
          { id: "street", label: "Street homeless" },
          { id: "unknown", label: "Not known" },
        ],
      },
      {
        id: "situation",
        label: "Situation",
        hint: "Current circumstances — housing, income, family, health, safety. The detail the dropdowns above cannot hold.",
        required: true,
        rows: 5,
        section: "Situation",
      },
      {
        id: "supportSystem",
        label: "Support system and family",
        hint: "Who is actually around them — family, friends, neighbours, other agencies — and who is doing the supporting.",
        required: false,
        rows: 3,
        section: "Situation",
      },
      {
        id: "benefits",
        label: "Benefits and resources",
        hint: "Tick what they are receiving now. An application that has gone in but not been decided is its own tick.",
        required: false,
        rows: 0,
        type: "multi",
        section: "Situation",
        options: [
          { id: "medicaid", label: "Medicaid" },
          { id: "medicare", label: "Medicare" },
          { id: "snap", label: "SNAP" },
          { id: "ssi", label: "SSI" },
          { id: "ssdi", label: "SSDI" },
          { id: "housing_assistance", label: "Housing assistance" },
          { id: "cash_assistance", label: "Cash assistance" },
          { id: "application_pending", label: "Application in progress" },
          { id: "none", label: "None" },
        ],
      },
      {
        /*
         * The picker, and the reason field types exist.
         *
         * This was a textarea, which could not be counted, compared or carried
         * forward — two workers writing "no stable housing" and "homeless"
         * about the same person produced two unrelated strings. Ticking is also
         * simply faster than describing, which was the complaint that started
         * this work.
         */
        id: "needsList",
        label: "What this person needs",
        hint: "Tick everything that applies. The office can see how this moves over time.",
        required: true,
        rows: 0,
        type: "multi",
        optionSource: "needs",
        section: "Needs",
      },
      {
        /*
         * Kept beside the picker rather than replaced by it. A list says which
         * domains apply and never says what is actually happening — "housing"
         * covers both an eviction notice due Friday and a sofa they have slept
         * on for a year, and a note writer needs the difference. No longer
         * required, because the picker now carries the part that must be there.
         */
        id: "needs",
        label: "In their words",
        hint: "What the person said about what they need, and how urgent it is to them.",
        required: false,
        rows: 4,
        section: "Needs",
      },
      {
        id: "safetyConcerns",
        label: "Safety concerns and risk factors",
        hint: "Anything that makes this person less safe — their own risk, someone else's, the housing itself, children or dependants. Write 'none identified' if there are none.",
        required: false,
        rows: 4,
        section: "Safety",
      },
      {
        id: "goalProgress",
        label: "Goals — progress and barriers",
        hint: "What they are working towards, what actually moved since last time, and what is in the way. The barrier is the part a reviewer needs.",
        required: false,
        rows: 4,
        section: "Progress and actions",
      },
      {
        id: "actions",
        label: "Actions taken",
        hint: "What you actually did this contact — calls made, forms submitted, advocacy, support provided.",
        required: true,
        rows: 4,
        section: "Progress and actions",
      },
      {
        id: "referrals",
        label: "Referrals and coordination",
        hint: "Agencies contacted or involved, and what each is now responsible for. Write 'none' if none.",
        required: true,
        rows: 3,
        section: "Progress and actions",
      },
      {
        id: "plan",
        label: "Plan and next contact",
        hint: "Next steps, who owns each, and when you are seeing or calling them again.",
        required: true,
        rows: 4,
        section: "Next steps",
      },
    ],
  },

  /**
   * Nurse practitioner encounters.
   *
   * Medication is its own required field rather than a line inside the plan.
   * It is the single most consequential thing in a nursing note to get wrong or
   * lose, and burying it in prose is how it gets missed by whatever writes the
   * final note — the export can only carry a field that exists.
   *
   * Risk is four graded fields rather than a paragraph, because the note
   * writers this feeds produce psychiatric evaluations and follow-ups, where
   * risk is a section with a level in it. A level can be compared against last
   * month's; a sentence cannot.
   */
  NURSING: {
    kind: "NURSING",
    name: "Nursing encounter",
    description: "Presentation, symptoms, mental status, risk, medication, plan.",
    fields: [
      ...commonHeader("This contact"),
      sinceLastContact("This contact", true),
      {
        id: "presentation",
        label: "Chief complaint",
        hint: "Why the client was seen, in their own words where you have them — symptoms, duration, how it is affecting them.",
        required: true,
        rows: 5,
        section: "This contact",
      },
      {
        id: "symptoms",
        label: "Current symptoms",
        hint: "Tick what is present now. The box underneath is where severity and duration go.",
        required: false,
        rows: 0,
        type: "multi",
        section: "Symptoms",
        options: [
          { id: "mood", label: "Mood — low or elevated" },
          { id: "anxiety", label: "Anxiety" },
          { id: "sleep", label: "Sleep" },
          { id: "appetite", label: "Appetite" },
          { id: "energy", label: "Energy" },
          { id: "concentration", label: "Concentration" },
          { id: "irritability", label: "Irritability or agitation" },
          { id: "psychosis", label: "Hallucinations or delusions" },
        ],
      },
      {
        id: "symptomDetail",
        label: "Symptoms in detail",
        hint: "For each one ticked: how bad, how long, and what makes it better or worse.",
        required: false,
        rows: 4,
        section: "Symptoms",
      },
      {
        /*
         * One field, not the nine the specification enumerates.
         *
         * Nine boxes on a phone is the form nobody finishes, and the export
         * carries identical text either way — a mental state examination is
         * written as continuous prose in every note this feeds. The nine are
         * named in the hint so none of them is forgotten. If note writers come
         * back wanting them apart, splitting one prose field into nine is a
         * migration of stored text and is worth being asked for.
         */
        id: "mentalStatus",
        label: "Mental status",
        hint: "Appearance, behaviour, speech, mood, affect, thought process, cognition, insight, judgement.",
        required: false,
        rows: 6,
        section: "Mental status",
      },
      {
        id: "riskSuicidal",
        label: "Suicidal ideation",
        hint: "What was asked, what they said, and what you did about it.",
        required: false,
        rows: 0,
        type: "severity",
        section: "Risk",
        options: RISK_LEVELS,
      },
      {
        id: "riskHomicidal",
        label: "Thoughts of harming others",
        hint: "Including any identified person, which changes what has to happen next.",
        required: false,
        rows: 0,
        type: "severity",
        section: "Risk",
        options: RISK_LEVELS,
      },
      {
        id: "riskSelfHarm",
        label: "Self-harm",
        hint: "Recent or current, and whether anything was found on examination.",
        required: false,
        rows: 0,
        type: "severity",
        section: "Risk",
        options: RISK_LEVELS,
      },
      {
        id: "riskSubstance",
        label: "Substance use",
        hint: "What, how much, how often, and when they last used.",
        required: false,
        rows: 0,
        type: "severity",
        section: "Risk",
        options: [
          { id: "none", label: "None reported" },
          { id: "occasional", label: "Occasional" },
          { id: "frequent", label: "Frequent" },
          { id: "daily", label: "Daily or dependent" },
        ],
      },
      {
        id: "observations",
        label: "Vitals and physical findings",
        hint: "Vitals, screening scores, physical findings. Record the actual figures, not 'within normal limits'.",
        required: true,
        rows: 4,
        section: "Findings",
      },
      {
        id: "historyUpdate",
        label: "History update",
        hint: "Anything new in their medical or psychiatric history since it was last recorded — admissions, diagnoses, procedures. Leave blank if nothing is new.",
        required: false,
        rows: 3,
        section: "Findings",
      },
      {
        id: "assessment",
        label: "Clinical impression",
        hint: "Your impression and working diagnosis, and any differential you are holding open.",
        required: true,
        rows: 4,
        section: "Impression and plan",
      },
      {
        id: "medication",
        label: "Medication",
        hint: "Current medication, anything started, stopped or changed today, with doses. Adherence and any side effects. Write 'no change' if nothing changed.",
        required: true,
        rows: 4,
        section: "Impression and plan",
      },
      {
        id: "plan",
        label: "Plan and follow-up",
        hint: "Investigations, referrals, safety-netting advice given, and when they are being seen again.",
        required: true,
        rows: 4,
        section: "Impression and plan",
      },
    ],
  },
};

export const TEMPLATE_LIST: Template[] = Object.values(TEMPLATES);

/**
 * A template's fields grouped into the sections the form renders.
 *
 * Consecutive fields sharing a `section` are one group. Grouping by runs rather
 * than by a declared list means the field order *is* the grouping — there is no
 * second structure to fall out of step with it, and a field moved between
 * sections moves by being moved.
 *
 * Fields with no section come back in a group whose title is null, which the
 * renderer draws bare. That is every field of every template that predates the
 * §3 work.
 */
export interface TemplateSection {
  title: string | null;
  fields: TemplateField[];
}

/**
 * What kind of contact this was, as a person reads it.
 *
 * The §5 filename's `[EncounterType]` segment and the line under the client
 * code on the exported page. The template *name* stood in for it until the
 * encounter-type dropdown existed — a nursing template can carry a crisis
 * contact or a psych follow-up, and a note writer sorting a folder by filename
 * needs the difference.
 *
 * Falls back to the template name for the one-box narrative, which has no
 * header, and for every submission filed before the field existed. Lives here
 * rather than in the PDF assembler so the derivation can be exercised without a
 * database — the assembler is `server-only` and cannot be imported into a plain
 * script.
 */
export function encounterTypeOf(
  kind: TemplateKind,
  fields: Record<string, unknown>
): string {
  const template = TEMPLATES[kind];
  const field = template.fields.find((f) => f.id === "encounterType");
  const chosen = field ? renderFieldValue(fields[field.id], field).trim() : "";
  return chosen || template.name;
}

export function sectionsOf(fields: TemplateField[]): TemplateSection[] {
  const out: TemplateSection[] = [];
  for (const field of fields) {
    const title = field.section ?? null;
    const last = out[out.length - 1];
    if (last && last.title === title) last.fields.push(field);
    else out.push({ title, fields: [field] });
  }
  return out;
}

/**
 * The whole submission as one block of text.
 *
 * This is not only for display — `submitEncounter` derives `rawText`,
 * `contentHash` and `normalizedText` from it, which means **duplicate detection
 * is built on this function's output**. When it silently dropped every
 * non-string value, a submission whose answers were all pickers produced an
 * empty string, an identical hash to every other such submission, and a
 * duplicate flag against all of them. Nothing threw. That is why the value
 * rendering lives in `renderFieldValue` and every caller shares it.
 */
export function flattenFields(
  kind: TemplateKind,
  fields: Record<string, unknown>
): string {
  return TEMPLATES[kind].fields
    .map((f) => {
      const rendered = renderFieldValue(fields[f.id], f);
      return rendered ? `${f.label}: ${rendered}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export interface Completeness {
  complete: boolean;
  /** Labels of the required fields that are empty or too thin to be a record. */
  missing: string[];
  /** 0–1, used by the queue to sort and by insights to report. */
  ratio: number;
}

/**
 * Whether a field is required *of this encounter*.
 *
 * A field made required after an encounter happened cannot be required of it.
 * See the note on `TemplateField.since`.
 */
function requiredFor(field: TemplateField, at: Date): boolean {
  if (!field.required) return false;
  if (!field.since) return true;
  // Compared as ISO days rather than as Date objects: `encounterDate` is a day,
  // stored at midnight UTC, and `since` is a day. Anything finer invents a
  // difference between two things that are the same date.
  return at.toISOString().slice(0, 10) >= field.since;
}

/**
 * A required field holding "ok" is not a completed field.
 *
 * The floor is deliberately low — eight characters — because the job here is to
 * catch the empty box and the accidental keystroke, not to referee how much
 * detail a clinician should write. Anything stricter would be this tool having
 * an opinion about clinical practice, which it has no standing to have.
 *
 * `at` is the **encounter date**, not now: it decides which required fields
 * applied when the contact happened. Callers that genuinely have no encounter
 * to speak of get today's rules.
 */
export function assessCompleteness(
  kind: TemplateKind,
  fields: Record<string, unknown>,
  at: Date = new Date()
): Completeness {
  const required = TEMPLATES[kind].fields.filter((f) => requiredFor(f, at));
  // `hasAnswer` rather than a length check: one ticked box is a complete answer
  // to a picker, and the eight-character floor that is right for prose would
  // have made a required picker field permanently incomplete — which blocks
  // signing the note, not just the form.
  const missing = required.filter((f) => !hasAnswer(fields[f.id], f)).map((f) => f.label);

  const filled = required.length - missing.length;
  return {
    complete: missing.length === 0,
    missing,
    ratio: required.length ? filled / required.length : 1,
  };
}
