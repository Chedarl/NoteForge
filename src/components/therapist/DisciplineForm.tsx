"use client";

import { useActionState } from "react";
import { setDiscipline, type ClientFormState } from "@/lib/clients/manage";
import { DISCIPLINE_HINT, DISCIPLINE_LABEL, DISCIPLINE_OPTIONS } from "@/lib/intake/disciplines";
import type { Discipline } from "@prisma/client";

/**
 * "Which are you?" — asked once, then carried on everything.
 *
 * It is a list of radio buttons with a sentence each rather than a dropdown,
 * because the choice determines which template a clinician is offered and
 * therefore what information ever gets collected. That is worth reading before
 * answering, and a dropdown is a control people close without reading.
 */
export default function DisciplineForm({ current }: { current: Discipline | null }) {
  const [state, formAction, pending] = useActionState<ClientFormState, FormData>(
    setDiscipline,
    {}
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-2">
        {DISCIPLINE_OPTIONS.map((discipline) => (
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
              <span className="block text-xs text-slate-500">{DISCIPLINE_HINT[discipline]}</span>
            </span>
          </label>
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
