"use client";

import { useActionState, useState } from "react";
import { resolveFlag } from "@/lib/workspace/actions";
import type { FlagKind } from "@prisma/client";

/**
 * A flag, the evidence behind it, and four buttons.
 *
 * The evidence is not optional. A flag that says "86% similar" and hides the
 * other document is asking a specialist to guess, and a guess made under queue
 * pressure will be "dismiss" every time. So the earlier submission's text is
 * right here, expandable, before any button is pressed.
 *
 * The four outcomes are deliberately not three. "Ask the therapist" has to be a
 * first-class answer, because the honest resolution of a contradiction about
 * risk is frequently that nobody in this building can settle it.
 */

const KIND_TITLE: Record<FlagKind, string> = {
  DUPLICATE: "Identical to an earlier submission",
  NEAR_DUPLICATE: "Looks like an earlier submission",
  CONFLICT: "Contradicts an earlier submission",
  STATUS_BLOCK: "Client is not accepting notes",
  LOW_CONFIDENCE: "Transcript confidence was low",
};

export default function FlagResolver({
  flagId,
  kind,
  detail,
  score,
  related,
}: {
  flagId: string;
  kind: FlagKind;
  detail: string | null;
  score: number | null;
  related: { id: string; encounterDate: string; excerpt: string } | null;
}) {
  const [showEvidence, setShowEvidence] = useState(kind === "CONFLICT");
  const [state, formAction, pending] = useActionState(resolveFlag, {});

  if (state.ok) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        Resolved. The decision and who made it are in the audit trail.
      </div>
    );
  }

  const severe = kind === "CONFLICT";

  return (
    <div
      className={`rounded-md border p-3 ${
        severe ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={`text-sm font-semibold ${severe ? "text-rose-900" : "text-amber-900"}`}>
          {KIND_TITLE[kind]}
        </h3>
        {score !== null ? (
          <span className="rounded bg-white/70 px-1.5 py-0.5 text-xs font-medium tabular-nums">
            {Math.round(score * 100)}% overlap
          </span>
        ) : null}
      </div>

      {detail ? (
        <p className={`mt-1 text-sm ${severe ? "text-rose-800" : "text-amber-800"}`}>{detail}</p>
      ) : null}

      {related ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            className="text-xs font-medium underline"
          >
            {showEvidence ? "Hide" : "Show"} the earlier submission ({related.encounterDate})
          </button>
          {showEvidence ? (
            <p className="prose-note mt-2 max-h-64 overflow-y-auto rounded border border-white bg-white/80 p-2 text-sm">
              {related.excerpt}
            </p>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="flagId" value={flagId} />
        {[
          { value: "KEPT_BOTH", label: "Both are genuine — keep going" },
          { value: "DISMISSED_DUPLICATE", label: "Duplicate — drop this one" },
          { value: "MARKED_UPDATE", label: "This replaces the earlier one" },
          { value: "NEEDS_CLARIFICATION", label: "Ask the therapist" },
        ].map((option) => (
          <button
            key={option.value}
            type="submit"
            name="resolution"
            value={option.value}
            disabled={pending}
            className="rounded border border-slate-400 bg-white px-2.5 py-1 text-xs font-medium disabled:opacity-60"
          >
            {option.label}
          </button>
        ))}
      </form>

      {state.error ? <p className="mt-1 text-xs text-rose-700">{state.error}</p> : null}
    </div>
  );
}
