"use client";

import { useActionState } from "react";
import { setDiscipline, type ClientFormState } from "@/lib/clients/manage";
import { DISCIPLINE_HINT, DISCIPLINE_LABEL, DISCIPLINE_OPTIONS } from "@/lib/intake/disciplines";
import { PERSONAS, PORTAL_FOR_DISCIPLINE, type PortalKind } from "@/lib/portal/personas";
import type { Discipline } from "@prisma/client";

/**
 * "Which are you?" — asked once, then carried on everything.
 *
 * It is a list of radio buttons with a sentence each rather than a dropdown,
 * because the choice determines which template a clinician is offered and
 * therefore what information ever gets collected. That is worth reading before
 * answering, and a dropdown is a control people close without reading.
 *
 * **Grouped by the workspace each one opens.** Six professions resolve to three
 * portals, and presenting six choices that produce three outcomes made the
 * screen look like it was asking something it was not — a recovery coach and a
 * social case worker pick differently and land in the same place, which reads
 * as the answer having been ignored.
 *
 * The six stay, because the discipline is not only a route to a workspace: it
 * is stamped on every submission and travels into the export, so the note
 * writer knows what kind of note to produce. Collapsing them would throw that
 * away to tidy a screen. Saying plainly which ones share a workspace costs
 * nothing and answers the question the grouping raises.
 */
export default function DisciplineForm({ current }: { current: Discipline | null }) {
  const [state, formAction, pending] = useActionState<ClientFormState, FormData>(
    setDiscipline,
    {}
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-5">
        {groups().map(([portal, disciplines]) => (
          <div key={portal}>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {PERSONAS[portal].title}
              {disciplines.length > 1 ? " · shared workspace" : ""}
            </p>
            <div className="space-y-2">
              {disciplines.map((discipline) => (
                <label
                  key={discipline}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="discipline"
                    value={discipline}
                    defaultChecked={current === discipline}
                    className="mt-0.5 size-4"
                  />
                  <span className="text-sm">
                    <span className="font-medium">{DISCIPLINE_LABEL[discipline]}</span>
                    <span className="block text-xs text-slate-500">
                      {DISCIPLINE_HINT[discipline]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {state.error ? <p className="text-sm text-rose-700">{state.error}</p> : null}
      {state.ok ? (
        <p className="text-sm font-medium text-emerald-700">
          Saved. Every note you submit from now on carries this, and it travels into the
          export so the right kind of note gets written from it.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : current ? "Update" : "Save"}
      </button>
    </form>
  );
}

/**
 * The six, in workspace order, preserving the order they are declared in.
 *
 * Built from `PORTAL_FOR_DISCIPLINE` rather than written out, so adding a
 * discipline or moving one between portals never leaves this screen describing
 * a grouping that is no longer true.
 */
function groups(): [PortalKind, Discipline[]][] {
  const byPortal = new Map<PortalKind, Discipline[]>();
  for (const discipline of DISCIPLINE_OPTIONS) {
    const portal = PORTAL_FOR_DISCIPLINE[discipline];
    const existing = byPortal.get(portal);
    if (existing) existing.push(discipline);
    else byPortal.set(portal, [discipline]);
  }
  return [...byPortal.entries()];
}
