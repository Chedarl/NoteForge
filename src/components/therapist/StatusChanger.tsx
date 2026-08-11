"use client";

import { useActionState, useState } from "react";
import { updateClientStatus } from "@/lib/intake/actions";
import { STATUS_LABEL, STATUS_OPTIONS } from "@/lib/clients/labels";
import type { ClientStatus } from "@prisma/client";

/**
 * Changing a status from the client list, in three taps.
 *
 * The friction here is the product. Every extra step between "the therapist
 * knows" and "the system knows" is another week of notes typed against somebody
 * who has been discharged, so this is a control on the row itself rather than a
 * form on a settings page nobody visits.
 *
 * The one piece of friction kept on purpose is the reason box: required for any
 * non-active status, because a discharge with no reason is a record that cannot
 * be defended later.
 */
export default function StatusChanger({
  clientId,
  current,
}: {
  clientId: string;
  current: ClientStatus;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ClientStatus>(current);
  const [state, formAction, pending] = useActionState(updateClientStatus, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Change status
      </button>
    );
  }

  if (state.ok) {
    return <span className="text-xs font-medium text-emerald-700">Status updated.</span>;
  }

  return (
    <form action={formAction} className="w-full max-w-sm space-y-2 rounded border border-slate-300 p-3">
      <input type="hidden" name="clientId" value={clientId} />

      <label className="block text-xs font-medium">
        New status
        <select
          name="status"
          value={selected}
          onChange={(e) => setSelected(e.target.value as ClientStatus)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      </label>

      {selected !== "ACTIVE" ? (
        <label className="block text-xs font-medium">
          Reason <span className="font-normal text-slate-500">(required)</span>
          <textarea
            name="reason"
            rows={2}
            required
            placeholder={
              selected === "DECEASED"
                ? "How and when you were notified."
                : "Why the status is changing."
            }
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      ) : null}

      {selected !== "ACTIVE" ? (
        <p className="text-xs text-amber-700">
          New notes will be refused for this client. Existing notes stay readable.
        </p>
      ) : null}

      {state.error ? <p className="text-xs text-rose-700">{state.error}</p> : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
