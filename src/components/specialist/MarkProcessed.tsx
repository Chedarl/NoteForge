"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { markProcessed, type ProcessedState } from "@/lib/workspace/actions";

/**
 * The last step, recorded by the person who took it.
 *
 * Deliberately plain and deliberately reversible. Marking the wrong row is an
 * ordinary mistake, and a one-way flag makes people hesitate before touching it
 * at all — which produces a field nobody fills in and therefore nobody trusts.
 *
 * The reference box is optional and unvalidated. Every destination system
 * formats its identifiers differently, and a pattern check here would reject
 * something real on a screen where the person typing is looking at the actual
 * value.
 */
export default function MarkProcessed({
  submissionId,
  processed,
  canProcess,
}: {
  submissionId: string;
  /** Present when it has already been filed. */
  processed: { at: string; by: string | null; version: number | null; reference: string | null } | null;
  /** False until the note is signed — there is nothing finished to file yet. */
  canProcess: boolean;
}) {
  const [state, action, pending] = useActionState<ProcessedState, FormData>(markProcessed, {});

  if (processed) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start gap-2">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-700" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">Filed in the practice&rsquo;s system</p>
            <p className="mt-0.5 text-xs text-emerald-800">
              {processed.at}
              {processed.by ? ` · ${processed.by}` : ""}
              {processed.version ? ` · note version ${processed.version}` : ""}
            </p>
            {processed.reference ? (
              <p className="mt-1 font-mono text-xs text-emerald-900">{processed.reference}</p>
            ) : null}
          </div>
        </div>

        <form action={action} className="mt-3">
          <input type="hidden" name="submissionId" value={submissionId} />
          <input type="hidden" name="undo" value="yes" />
          <button
            type="submit"
            disabled={pending}
            className="text-xs font-medium text-emerald-900 underline disabled:opacity-60"
          >
            {pending ? "Undoing…" : "Mark it not filed after all"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[color:var(--nf-border)] bg-white p-4">
      <p className="text-sm font-semibold text-slate-900">Has this been filed?</p>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
        A signed note here is not a note in Credible or ICANotes. Mark it once somebody has
        actually entered it, so &ldquo;what have we produced that nobody has filed&rdquo; has
        an answer.
      </p>

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="submissionId" value={submissionId} />
        <div className="min-w-40 flex-1">
          <label htmlFor="reference" className="block text-xs font-medium text-slate-700">
            Their reference (optional)
          </label>
          <input
            id="reference"
            name="reference"
            maxLength={120}
            placeholder="e.g. the id their system gave back"
            className="nf-field mt-1"
            disabled={!canProcess}
          />
        </div>
        <button
          type="submit"
          disabled={pending || !canProcess}
          className="h-[42px] rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Mark filed"}
        </button>
      </form>

      {!canProcess ? (
        <p className="mt-2 text-xs text-slate-500">
          Available once the note is signed — there is nothing finished to file yet.
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
