"use client";

import Dictate from "@/components/therapist/Dictate";
import {
  fieldType,
  isSeverityValue,
  type TemplateField as FieldDef,
  type SeverityValue,
} from "@/lib/intake/templates";
import type { NeedDefinition } from "@/lib/intake/needs";

/**
 * One template field, rendered as whatever kind of control it is.
 *
 * There are three screens that render `TEMPLATES[kind].fields` — the intake
 * form, the note editor, and the read-only view on the note page — and before
 * this component each had its own copy of the loop. That was survivable while
 * every field was a textarea and would not be now: a picker added to one and
 * missed in another is a field that silently loses its answer when the note is
 * saved. One renderer, three callers.
 */

export interface FieldRendererProps {
  field: FieldDef;
  /** Whatever is stored for this field: string, string[] or a severity object. */
  value?: unknown;
  /** Resolved needs list, for a field whose options come from the practice. */
  needs?: readonly NeedDefinition[];
  disabled?: boolean;
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asSeverity(value: unknown): SeverityValue {
  return isSeverityValue(value) ? value : { level: "", note: "" };
}

export default function TemplateFieldInput({
  field,
  value,
  needs = [],
  disabled,
}: FieldRendererProps) {
  const type = fieldType(field);

  const header = (
    <div className="flex items-end justify-between gap-3">
      <label htmlFor={field.id} className="nf-label">
        {field.label}
        {field.required ? <span className="text-rose-600"> *</span> : null}
      </label>
      {/* Dictation is for prose. Speaking into a checkbox group does nothing,
          and offering it there just makes the control look broken. */}
      {type === "prose" ? <Dictate targetId={field.id} /> : null}
    </div>
  );

  if (type === "multi") {
    const options = field.optionSource === "needs" ? needs : (field.options ?? []);
    const selected = new Set(asArray(value));
    return (
      <fieldset disabled={disabled}>
        <legend className="nf-label">
          {field.label}
          {field.required ? <span className="text-rose-600"> *</span> : null}
        </legend>
        <p className="mt-0.5 mb-2 text-xs text-slate-500">{field.hint}</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-[color:var(--nf-border)] bg-white px-2.5 py-2 text-sm hover:border-slate-400"
            >
              <input
                type="checkbox"
                name={field.id}
                value={option.id}
                defaultChecked={selected.has(option.id)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-slate-800">{option.label}</span>
                {"hint" in option && option.hint ? (
                  <span className="block text-xs leading-snug text-slate-500">{option.hint}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  if (type === "severity") {
    const current = asSeverity(value);
    return (
      <div>
        {header}
        <p className="mt-0.5 text-xs text-slate-500">{field.hint}</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-[10rem_1fr]">
          <select
            id={field.id}
            name={`${field.id}__level`}
            defaultValue={current.level}
            disabled={disabled}
            className="nf-field"
          >
            <option value="">Not assessed</option>
            {(field.options ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            name={`${field.id}__note`}
            defaultValue={current.note}
            disabled={disabled}
            placeholder="What was said, and what you did about it"
            className="nf-field"
            aria-label={`${field.label} detail`}
          />
        </div>
      </div>
    );
  }

  if (type === "choice") {
    return (
      <div>
        {header}
        <p className="mt-0.5 text-xs text-slate-500">{field.hint}</p>
        <select
          id={field.id}
          name={field.id}
          defaultValue={typeof value === "string" ? value : ""}
          disabled={disabled}
          className="nf-field mt-1"
        >
          <option value="">Choose…</option>
          {(field.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      {header}
      <p className="mt-0.5 text-xs text-slate-500">{field.hint}</p>
      {/*
        `aria-required`, never the `required` attribute.

        A `required` control inside a collapsed `<details>` makes the browser
        refuse the submit with "An invalid form control is not focusable" — no
        message on screen, no scroll, nothing at all happens when the button is
        pressed. With the §3 sections that is the whole form dead and the cause
        invisible. Nothing is lost by dropping it: `assessCompleteness` runs
        server-side on every intake path and returns the missing fields by name,
        which is the gate that actually holds.
      */}
      <textarea
        id={field.id}
        name={field.id}
        rows={field.rows}
        aria-required={field.required}
        defaultValue={typeof value === "string" ? value : ""}
        disabled={disabled}
        className="nf-field mt-1"
      />
    </div>
  );
}
