"use client";

import { useActionState } from "react";
import { Check, CornerUpLeft } from "lucide-react";
import { approveFieldUpdate, returnFieldUpdate, type ReviewState } from "@/lib/field/review";

/**
 * One field update, waiting on a clinician.
 *
 * Two buttons and one box. The box is the clinician's own words and is kept
 * apart from the worker's account rather than appended to it — a nurse's
 * clarification merged into a coach's sentence could not be told apart
 * afterwards, and the document has to show who said which.
 *
 * Approving is one tap because that is the common case and friction there means
 * updates sit unread. Sending back demands a reason, because a worker who is
 * told only "returned" has no idea what to do differently.
 */
export default function ReviewCard({
  submissionId,
  clientCode,
  clientName,
  workerName,
  workerRole,
  when,
  text,
}: {
  submissionId: string;
  clientCode: string;
  clientName: string | null;
  workerName: string;
  workerRole: string;
  when: string;
  text: string;
}) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(
    approveFieldUpdate,
    {}
  );
  const [returnState, returnAction, returning] = useActionState<ReviewState, FormData>(
    returnFieldUpdate,
    {}
  );

  if (state.approved) {
    return (
      <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
        <Check size={15} className="mr-1.5 inline" />
        {clientCode} approved and sent for documentation.
      </div>
    );
  }

  if (returnState.returned) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {clientCode} sent back to {workerName}. It stays on the record.
      </div>
    );
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="font-semibold text-slate-900">{clientCode}</h3>
        {clientName ? <span className="text-sm text-slate-500">{clientName}</span> : null}
        <span className="ml-auto text-xs text-slate-500">
          {workerName} · {workerRole} · seen {when}
        </span>
      </header>

      <p className="prose-note mt-3 border-l-2 border-slate-200 pl-3 text-sm leading-relaxed text-slate-800">
        {text}
      </p>

      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="submissionId" value={submissionId} />
        <label htmlFor={`note_${submissionId}`} className="sr-only">
          Your note on this update
        </label>
        <input
          id={`note_${submissionId}`}
          name="reviewNote"
          placeholder="Anything to add for the person writing the note (optional)"
          className="nf-field text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className="nf-btn nf-btn-primary">
            <Check size={15} />
            <span className="ml-1.5">{pending ? "Approving…" : "Approve and send on"}</span>
          </button>
          <button
            type="submit"
            formAction={returnAction}
            disabled={returning}
            className="nf-btn nf-btn-secondary"
          >
            <CornerUpLeft size={15} />
            <span className="ml-1.5">{returning ? "Sending back…" : "Send back"}</span>
          </button>
        </div>
        {state.error ? (
          <p role="alert" className="text-xs text-rose-700">
            {state.error}
          </p>
        ) : null}
        {returnState.error ? (
          <p role="alert" className="text-xs text-rose-700">
            {returnState.error}
          </p>
        ) : null}
      </form>
    </article>
  );
}
