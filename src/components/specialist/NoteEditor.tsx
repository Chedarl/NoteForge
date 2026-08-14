"use client";

import TemplateFieldInput from "@/components/shared/TemplateField";
import { fieldType } from "@/lib/intake/templates";
import type { NeedDefinition } from "@/lib/intake/needs";

import { useActionState, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { saveNote, proposeDraft, addNoteTag, type NoteState } from "@/lib/workspace/actions";
import { TEMPLATES } from "@/lib/intake/templates";
import { Pill } from "@/components/shared/ui";
import type { NoteState as NoteStateEnum, TagKind, TemplateKind } from "@prisma/client";

const TAG_LABELS: Record<TagKind, string> = {
  GOAL_PROGRESS: "Goal progressing",
  GOAL_STALLED: "Goal stalled",
  RISK: "Risk noted",
  ENGAGEMENT_DROP: "Engagement dropping",
};

/**
 * The note being produced.
 *
 * ## The signing gate
 *
 * Save is always available; sign is not. A half-written note can be parked and
 * picked up after lunch, but nothing incomplete can be handed to a practice —
 * so the completeness check runs at signature, and names the sections that are
 * still empty rather than refusing with a shrug.
 *
 * ## "Propose a draft" is a text-insertion button and nothing more
 *
 * It fills these same textareas with text a person then reads, edits and signs.
 * It cannot save, cannot sign, and cannot fill a section the source did not
 * support — those come back empty with a note in `gaps` saying what is missing,
 * which is far more useful than fluent text nobody can trace to the source.
 *
 * ## Tags are typed by a person, deliberately
 *
 * Everything on the clinical half of the insights dashboard comes from these
 * four buttons. A trend built from what a trained specialist marked is evidence
 * a supervisor can act on; the same trend inferred by a classifier reading note
 * text is a liability with a chart on it.
 */
export default function NoteEditor({
  submissionId,
  noteId,
  templateKind,
  initialBody,
  needs,
  state: noteState,
  aiAssisted,
  tags,
}: {
  submissionId: string;
  noteId: string;
  templateKind: TemplateKind;
  initialBody: Record<string, unknown>;
  /** Resolved needs list for any picker fields in this template. */
  needs: NeedDefinition[];
  state: NoteStateEnum;
  aiAssisted: boolean;
  tags: { id: string; kind: TagKind; label: string }[];
}) {
  const template = TEMPLATES[templateKind];
  const [body, setBody] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    // Prose defaults to "" so the textarea is controlled from the first render;
    // everything else keeps whatever shape it arrived in.
    for (const field of template.fields) {
      initial[field.id] =
        initialBody[field.id] ?? (fieldType(field) === "prose" ? "" : undefined);
    }
    return initial;
  });

  const [saveState, saveAction, saving] = useActionState<NoteState, FormData>(saveNote, {});
  const [draftState, draftAction, drafting] = useActionState(proposeDraft, {});
  const [tagState, tagAction, tagging] = useActionState(addNoteTag, {});

  // When a draft comes back, it goes into the boxes — never straight to the
  // database. The specialist is the one who decides any of it is worth keeping.
  useEffect(() => {
    if (draftState.fields) setBody((prev) => ({ ...prev, ...draftState.fields }));
  }, [draftState.fields]);

  const signed = noteState === "SIGNED" || noteState === "DELIVERED";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {template.name} note
          </h2>
          <div className="flex items-center gap-2">
            {aiAssisted ? <Pill tone="sky">AI-assisted</Pill> : null}
            {signed ? <Pill tone="emerald">Signed</Pill> : <Pill>Draft</Pill>}
          </div>
        </div>

        <form action={draftAction} className="mt-3">
          <input type="hidden" name="submissionId" value={submissionId} />
          <button
            type="submit"
            disabled={drafting}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-60"
          >
            <Sparkles size={12} />
            {drafting ? "Reading the source…" : "Propose a draft from the source"}
          </button>
        </form>

        {draftState.error ? (
          <p className="mt-2 text-xs text-amber-800">{draftState.error}</p>
        ) : null}
        {draftState.gaps && draftState.gaps.length > 0 ? (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            <p className="font-medium">The source did not cover:</p>
            <ul className="mt-1 list-inside list-disc">
              {draftState.gaps.map((gap, i) => (
                <li key={i}>{gap}</li>
              ))}
            </ul>
            <p className="mt-1">
              These were left empty on purpose. Fill them from the source or ask the therapist —
              do not write them from the pattern of other notes.
            </p>
          </div>
        ) : null}

        <form action={saveAction} className="mt-4 space-y-4">
          <input type="hidden" name="submissionId" value={submissionId} />

          {/*
            Prose stays controlled, because the drafter writes into it and the
            textarea has to show what arrived. Pickers are uncontrolled and
            rendered by the shared component: nothing fills them automatically,
            and a controlled checkbox group here would be state for its own
            sake. Both post by name, and `readField` reads either back.
          */}
          {template.fields.map((field) =>
            fieldType(field) === "prose" ? (
              <div key={field.id}>
                <label htmlFor={`note_${field.id}`} className="block text-sm font-medium">
                  {field.label}
                  {field.required ? <span className="text-rose-600"> *</span> : null}
                </label>
                <textarea
                  id={`note_${field.id}`}
                  name={field.id}
                  rows={field.rows}
                  value={typeof body[field.id] === "string" ? (body[field.id] as string) : ""}
                  onChange={(e) => setBody((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-relaxed"
                />
              </div>
            ) : (
              <TemplateFieldInput
                key={field.id}
                field={field}
                value={body[field.id]}
                needs={needs}
              />
            )
          )}

          {saveState.error ? (
            <div role="alert" className="rounded border border-rose-300 bg-rose-50 p-3">
              <p className="text-sm text-rose-800">{saveState.error}</p>
              {saveState.missing?.length ? (
                <p className="mt-1 text-sm text-rose-700">
                  Still empty: {saveState.missing.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {saveState.saved ? <p className="text-xs text-slate-500">Draft saved.</p> : null}
          {saveState.signed ? (
            <p className="text-sm font-medium text-emerald-700">
              Signed and delivered. Turnaround has been recorded.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              name="intent"
              value="save"
              disabled={saving}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              Save draft
            </button>
            <button
              type="submit"
              name="intent"
              value="sign"
              disabled={saving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {signed ? "Sign new version" : "Sign and deliver"}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Signing records your name and the time, and freezes this version. Later edits create
            a new version rather than overwriting this one.
          </p>
        </form>
      </div>

      {/* ── Tags ───────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Signals for the practice dashboard
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          What you mark here is the only thing that reaches the insights page. No text from this
          note is ever shown to a therapist as an insight.
        </p>

        {tags.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag.id}>
                <Pill tone={tag.kind === "RISK" ? "rose" : "slate"}>
                  {TAG_LABELS[tag.kind]}: {tag.label}
                </Pill>
              </li>
            ))}
          </ul>
        ) : null}

        <form action={tagAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="noteId" value={noteId} />
          <label className="text-xs font-medium">
            Signal
            <select
              name="kind"
              className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              {(Object.keys(TAG_LABELS) as TagKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {TAG_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-xs font-medium">
            Label
            <input
              name="label"
              placeholder="e.g. sleep hygiene goal"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={tagging}
            className="rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            Add
          </button>
        </form>
        {tagState.error ? <p className="mt-1 text-xs text-rose-700">{tagState.error}</p> : null}
      </div>
    </div>
  );
}
