import "server-only";

import { z } from "zod";
import { kimiJson } from "@/lib/ai/kimi";
import { TEMPLATES, fieldType } from "@/lib/intake/templates";
import type { TemplateKind } from "@prisma/client";

/**
 * Proposes a template-shaped draft from source material a human has already
 * verified.
 *
 * This is the feature with the most obvious appeal and the most obvious way to
 * do real harm, so the constraints are tight:
 *
 *  - **It only ever reorganises.** The instruction is explicit that it may not
 *    add a clinical observation, a risk judgement, a diagnosis or a plan step
 *    that is not present in the source. A model that helpfully writes "denies
 *    current suicidal ideation" because that sentence appears in most notes
 *    would be producing a false clinical record, and it would be *signed* by
 *    somebody who trusted it.
 *  - **It runs on verified text only.** The call site passes the transcript a
 *    human confirmed, never raw OCR — otherwise a misread digit gets laundered
 *    into fluent prose and stops looking like a misread digit.
 *  - **It leaves gaps visible.** A template field with no basis in the source
 *    comes back empty, not filled with something plausible. An empty required
 *    field is caught by the completeness gate and a person deals with it.
 *  - **It cannot sign.** The note is marked `aiAssisted`, stays a DRAFT, and a
 *    named human signs it.
 */

export interface DraftResult {
  fields: Record<string, string>;
  /** Anything the source did not support, stated plainly for the specialist. */
  gaps: string[];
}

export async function draftNote(
  kind: TemplateKind,
  sourceText: string
): Promise<DraftResult | null> {
  const template = TEMPLATES[kind];
  /*
   * Prose fields only.
   *
   * The model is asked to reorganise words into sections. A picker is not
   * words — asking for `{ type: "string" }` on a needs list would invite it to
   * invent "housing, food" as prose, and whatever came back would overwrite a
   * set of choices a person actually made. Those fields are left exactly as the
   * clinician set them, which is also the rule at the top of this file: a
   * machine may propose, only a named human commits.
   */
  const proseFields = template.fields.filter((f) => fieldType(f) === "prose");
  const fieldIds = proseFields.map((f) => f.id);

  const properties: Record<string, unknown> = {};
  for (const field of proseFields) {
    properties[field.id] = { type: "string" };
  }
  properties.gaps = { type: "array", items: { type: "string" } };

  const raw = await kimiJson<unknown>({
    system: `You reorganise verified clinical session material into a ${template.name} note.

Absolute rules:
- Use ONLY information present in the source. Never add an observation, risk judgement, diagnosis, medication, measurement or plan step that is not there.
- Never soften, escalate or reinterpret a risk statement. Reproduce its substance exactly.
- Keep the clinician's own terminology. Do not translate lay wording into clinical jargon.
- If the source does not support a field, return an EMPTY STRING for that field and add a short line to "gaps" saying what is missing. Never fill a gap with plausible text.
- Preserve any [?] markers from the transcript; they mark words a human could not read.
- Return only the JSON object.

Fields: ${proseFields.map((f) => `${f.id} (${f.label}: ${f.hint})`).join("; ")}`,
    user: `SOURCE MATERIAL:\n\n${sourceText.slice(0, 12000)}`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [...fieldIds, "gaps"],
      properties,
    },
    schemaName: "note_draft",
    maxTokens: 3000,
    scope: "note.draft",
  });
  if (!raw) return null;

  const shape: Record<string, z.ZodTypeAny> = { gaps: z.array(z.string()) };
  for (const id of fieldIds) shape[id] = z.string();
  const parsed = z.object(shape).safeParse(raw);
  if (!parsed.success) return null;

  const fields: Record<string, string> = {};
  for (const id of fieldIds) fields[id] = String(parsed.data[id] ?? "");

  return { fields, gaps: (parsed.data.gaps as string[]) ?? [] };
}
