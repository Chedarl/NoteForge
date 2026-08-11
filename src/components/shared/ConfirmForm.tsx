"use client";

import { useActionState, useState } from "react";
import { answerConfirmation, type ConfirmState } from "@/lib/clients/confirmActions";

const CHANGES = [
  { value: "DISCHARGED", label: "Discharged" },
  { value: "TRANSFERRED", label: "Transferred elsewhere" },
  { value: "ON_HOLD", label: "Paused" },
  { value: "DECEASED", label: "They have died" },
];

/**
 * Two taps for "yes, still active" — the answer we expect most of the time and
 * the one that must be effortless, or the whole channel gets ignored.
 *
 * Anything else opens a reason box, because a status change without a reason is
 * a record nobody can account for later.
 */
export default function ConfirmForm({ token }: { token: string }) {
  const [changing, setChanging] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<ConfirmState, FormData>(
    answerConfirmation,
    {}
  );

  if (state.done) {
    return <p className="mt-6 rounded-md bg-emerald-50 p-4 text-sm text-emerald-800">{state.done}</p>;
  }

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />

      {!changing ? (
        <>
          <button
            type="submit"
            name="answer"
            value="CONFIRMED_ACTIVE"
            disabled={pending}
            className="w-full rounded-md bg-emerald-700 px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
          >
            Yes — still in treatment
          </button>

          <div className="space-y-2">
            <p className="text-sm font-medium">No, something has changed:</p>
            {CHANGES.map((change) => (
              <button
                key={change.value}
                type="button"
                onClick={() => setChanging(change.value)}
                className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-left text-sm"
              >
                {change.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name="answer" value={changing} />
          <p className="text-sm font-medium">
            {CHANGES.find((c) => c.value === changing)?.label}
          </p>
          <label className="block text-sm">
            A short reason for the record <span className="text-slate-500">(required)</span>
            <textarea
              name="reason"
              rows={3}
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder={
                changing === "DECEASED"
                  ? "How and when you were notified."
                  : "Briefly, what changed."
              }
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "Recording…" : "Record this"}
            </button>
            <button
              type="button"
              onClick={() => setChanging(null)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Back
            </button>
          </div>
        </>
      )}

      {state.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
