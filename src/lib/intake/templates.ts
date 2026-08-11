import type { TemplateKind } from "@prisma/client";

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

export interface TemplateField {
  id: string;
  label: string;
  /** One line under the label. The difference between a filled field and a good one. */
  hint: string;
  required: boolean;
  rows: number;
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
};

export const TEMPLATE_LIST: Template[] = Object.values(TEMPLATES);

/** Every field's text, in template order, as one string. */
export function flattenFields(
  kind: TemplateKind,
  fields: Record<string, unknown>
): string {
  return TEMPLATES[kind].fields
    .map((f) => {
      const value = fields[f.id];
      return typeof value === "string" && value.trim() ? `${f.label}: ${value.trim()}` : "";
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
const MIN_MEANINGFUL_CHARS = 8;

export function assessCompleteness(
  kind: TemplateKind,
  fields: Record<string, unknown>
): Completeness {
  const required = TEMPLATES[kind].fields.filter((f) => f.required);
  const missing = required
    .filter((f) => {
      const value = fields[f.id];
      return typeof value !== "string" || value.trim().length < MIN_MEANINGFUL_CHARS;
    })
    .map((f) => f.label);

  const filled = required.length - missing.length;
  return {
    complete: missing.length === 0,
    missing,
    ratio: required.length ? filled / required.length : 1,
  };
}
