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
 * differ: eight characters is a sensible floor for prose and meaningless for a
 * picker, where one tick is a complete answer.
 */
export function hasAnswer(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length >= MIN_MEANINGFUL_CHARS;
  if (Array.isArray(value)) return value.some((i) => typeof i === "string" && i.trim());
  if (isSeverityValue(value)) return value.level.trim().length > 0;
  return false;
}

export interface Template {
  kind: TemplateKind;
  name: string;
  description: string;
  fields: TemplateField[];
}

export const TEMPLATES: Record<TemplateKind, Template> = {
  SOAP: {
    kind: "SOAP",
    name: "SOAP",
    description: "Subjective, Objective, Assessment, Plan.",
    fields: [
      {
        id: "subjective",
        label: "Subjective",
        hint: "What the client reported, in their framing.",
        required: true,
        rows: 5,
      },
      {
        id: "objective",
        label: "Objective",
        hint: "What you observed — presentation, affect, engagement, any measures taken.",
        required: true,
        rows: 4,
      },
      {
        id: "assessment",
        label: "Assessment",
        hint: "Your clinical impression and how it relates to the formulation.",
        required: true,
        rows: 4,
      },
      {
        id: "plan",
        label: "Plan",
        hint: "Next steps, homework, referrals, and when you are seeing them again.",
        required: true,
        rows: 4,
      },
    ],
  },
  DAP: {
    kind: "DAP",
    name: "DAP",
    description: "Data, Assessment, Plan.",
    fields: [
      {
        id: "data",
        label: "Data",
        hint: "Reported and observed, together.",
        required: true,
        rows: 6,
      },
      {
        id: "assessment",
        label: "Assessment",
        hint: "Your interpretation of the data above.",
        required: true,
        rows: 4,
      },
      { id: "plan", label: "Plan", hint: "Next steps and next appointment.", required: true, rows: 4 },
    ],
  },
  BIRP: {
    kind: "BIRP",
    name: "BIRP",
    description: "Behaviour, Intervention, Response, Plan.",
    fields: [
      {
        id: "behaviour",
        label: "Behaviour",
        hint: "Presenting behaviour and reported experience this session.",
        required: true,
        rows: 4,
      },
      {
        id: "intervention",
        label: "Intervention",
        hint: "What you did — modality, technique, focus.",
        required: true,
        rows: 4,
      },
      {
        id: "response",
        label: "Response",
        hint: "How the client responded to the intervention.",
        required: true,
        rows: 4,
      },
      { id: "plan", label: "Plan", hint: "Next steps and next appointment.", required: true, rows: 4 },
    ],
  },
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
   * Social case work.
   *
   * Built around what a case management note has to be able to evidence:
   * what the situation is, what was done about it, who else is now involved,
   * and when it is next being looked at. "Actions taken" is required and
   * separate from "plan" on purpose — a case note that records intentions but
   * not actions cannot demonstrate that anything happened.
   */
  CASE_MANAGEMENT: {
    kind: "CASE_MANAGEMENT",
    name: "Case management",
    description: "Situation, needs, actions taken, referrals, plan.",
    fields: [
      {
        id: "situation",
        label: "Situation",
        hint: "Current circumstances — housing, income, family, health, safety. What has changed since last contact.",
        required: true,
        rows: 5,
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
      },
      {
        id: "actions",
        label: "Actions taken",
        hint: "What you actually did this contact — calls made, forms submitted, advocacy, support provided.",
        required: true,
        rows: 4,
      },
      {
        id: "referrals",
        label: "Referrals and coordination",
        hint: "Agencies contacted or involved, and what each is now responsible for. Write 'none' if none.",
        required: true,
        rows: 3,
      },
      {
        id: "plan",
        label: "Plan and next contact",
        hint: "Next steps, who owns each, and when you are seeing or calling them again.",
        required: true,
        rows: 4,
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
   */
  NURSING: {
    kind: "NURSING",
    name: "Nursing encounter",
    description: "Presentation, observations, assessment, medication, plan.",
    fields: [
      {
        id: "presentation",
        label: "Presenting concern",
        hint: "Why the client was seen, and what they reported — symptoms, duration, how it is affecting them.",
        required: true,
        rows: 5,
      },
      {
        id: "observations",
        label: "Observations and measures",
        hint: "Vitals, screening scores, physical findings. Record the actual figures, not 'within normal limits'.",
        required: true,
        rows: 4,
      },
      {
        id: "assessment",
        label: "Assessment",
        hint: "Your clinical impression, and any differential you are holding open.",
        required: true,
        rows: 4,
      },
      {
        id: "medication",
        label: "Medication",
        hint: "Current medication, anything started, stopped or changed today, with doses. Write 'no change' if nothing changed.",
        required: true,
        rows: 3,
      },
      {
        id: "plan",
        label: "Plan and follow-up",
        hint: "Investigations, referrals, safety-netting advice given, and when they are being seen again.",
        required: true,
        rows: 4,
      },
    ],
  },
};

export const TEMPLATE_LIST: Template[] = Object.values(TEMPLATES);

/** Every field's text, in template order, as one string. */
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
 * A required field holding "ok" is not a completed field.
 *
 * The floor is deliberately low — eight characters — because the job here is to
 * catch the empty box and the accidental keystroke, not to referee how much
 * detail a clinician should write. Anything stricter would be this tool having
 * an opinion about clinical practice, which it has no standing to have.
 */
export function assessCompleteness(
  kind: TemplateKind,
  fields: Record<string, unknown>
): Completeness {
  const required = TEMPLATES[kind].fields.filter((f) => f.required);
  // `hasAnswer` rather than a length check: one ticked box is a complete answer
  // to a picker, and the eight-character floor that is right for prose would
  // have made a required picker field permanently incomplete — which blocks
  // signing the note, not just the form.
  const missing = required.filter((f) => !hasAnswer(fields[f.id])).map((f) => f.label);

  const filled = required.length - missing.length;
  return {
    complete: missing.length === 0,
    missing,
    ratio: required.length ? filled / required.length : 1,
  };
}
