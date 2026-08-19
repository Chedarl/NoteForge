"use client";

import { useEffect, useRef } from "react";
import { sectionsOf, type TemplateField } from "@/lib/intake/templates";

/**
 * A template's fields, grouped into the collapsible sections it declares.
 *
 * The §3 field sets made the nursing form about twenty fields long, which is a
 * form nobody scrolls to the bottom of on a phone. Grouping is not decoration
 * here: "Risk" is four questions a nurse practitioner answers together and a
 * case worker never sees, and a heading is what makes that legible.
 *
 * Native `<details>` rather than a hand-built accordion, and that is the
 * load-bearing choice: **a collapsed `<details>` still submits the inputs
 * inside it.** Conditional rendering would silently drop a section's answers
 * the moment somebody collapsed it after typing, which would look like the form
 * losing work at random.
 *
 * The renderer is passed in rather than assumed, because the two callers draw a
 * prose field differently: intake uses the shared uncontrolled input, and the
 * note editor keeps prose controlled so the drafter can write into it.
 */
export default function TemplateSections({
  fields,
  renderField,
  collapseOnPhone = false,
  openEverything = false,
}: {
  fields: TemplateField[];
  renderField: (field: TemplateField) => React.ReactNode;
  /**
   * Close all but the first section on a small screen, once, after hydration.
   *
   * Deliberately not server-rendered closed: with no JavaScript, or in the note
   * editor on a desktop, the whole form should be visible. This is a phone
   * affordance applied to a form that already works without it.
   */
  collapseOnPhone?: boolean;
  /**
   * Open every section. Set when the server has come back naming required
   * fields that are empty — a missing field inside a section the clinician
   * cannot see is an error message about something invisible.
   */
  openEverything?: boolean;
}) {
  const groups = sectionsOf(fields);
  const refs = useRef<(HTMLDetailsElement | null)[]>([]);

  useEffect(() => {
    if (!collapseOnPhone) return;
    if (!window.matchMedia("(max-width: 640px)").matches) return;
    // Imperative rather than a controlled `open` prop: once collapsed, the
    // sections belong to the person using them, and a controlled value would
    // reopen or refuse to close on the next render.
    refs.current.forEach((el, i) => {
      if (el && i > 0) el.open = false;
    });
  }, [collapseOnPhone]);

  useEffect(() => {
    if (!openEverything) return;
    refs.current.forEach((el) => {
      if (el) el.open = true;
    });
  }, [openEverything]);

  return (
    <div className="space-y-4">
      {groups.map((group, index) =>
        group.title === null ? (
          // Every field of every template that predates the §3 sections.
          <div key={`bare-${index}`} className="space-y-4">
            {group.fields.map((field) => renderField(field))}
          </div>
        ) : (
          <details
            key={group.title}
            open
            ref={(el) => {
              refs.current[index] = el;
            }}
            className="nf-section group rounded-lg border border-[color:var(--nf-border)] bg-white"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-semibold text-slate-800">{group.title}</span>
              <span className="text-xs text-slate-500">
                {group.fields.length} field{group.fields.length === 1 ? "" : "s"}
                <span
                  aria-hidden
                  className="ml-2 inline-block transition-transform group-open:rotate-90"
                >
                  ›
                </span>
              </span>
            </summary>
            <div className="space-y-4 border-t border-[color:var(--nf-border)] px-4 py-4">
              {group.fields.map((field) => renderField(field))}
            </div>
          </details>
        )
      )}
    </div>
  );
}
