"use client";

import { useEffect, useState, useTransition } from "react";
import { fetchPreviousSubmission } from "@/lib/intake/previousAction";
import type { PreviousSummary } from "@/lib/intake/previous";

/**
 * "Here is what was recorded last time" — above the form, before anything is
 * typed.
 *
 * It follows the client dropdown rather than the page, because the clinician
 * changes who they are writing about far more often than they reload. A server
 * action fetch on change keeps this a live read: the previous submission is not
 * baked into the page at load, so a colleague filing something two minutes ago
 * is visible here.
 *
 * Nothing is pre-filled from it, deliberately. See the note in `previous.ts`.
 */
export default function PreviousSubmission({
  clientId,
  initial,
}: {
  clientId: string;
  /** Rendered on the server for the client the page opened on, so it is there immediately. */
  initial: PreviousSummary | null;
}) {
  const [summary, setSummary] = useState<PreviousSummary | null>(initial);
  const [shownFor, setShownFor] = useState(clientId);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (clientId === shownFor) return;
    startTransition(async () => {
      const next = await fetchPreviousSubmission(clientId);
      setSummary(next);
      setShownFor(clientId);
    });
  }, [clientId, shownFor]);

  if (pending) {
    return (
      <div className="mt-4 rounded-lg border border-[color:var(--nf-border)] bg-white px-4 py-3 text-sm text-slate-500">
        Looking up the last encounter…
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-[color:var(--nf-border)] px-4 py-3 text-sm text-slate-500">
        Nothing has been filed for this client yet. This will be the first record.
      </div>
    );
  }

  return (
    <details
      open
      className="nf-section group mt-4 rounded-lg border border-[color:var(--nf-border)] bg-white"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-slate-800">
          Last time · {summary.encounterType}
        </span>
        <span className="text-xs text-slate-500">
          {summary.daysSince === 0 ? "today" : `${summary.daysSince}d ago`}
          <span aria-hidden className="ml-2 inline-block transition-transform group-open:rotate-90">
            ›
          </span>
        </span>
      </summary>

      <div className="space-y-3 border-t border-[color:var(--nf-border)] px-4 py-3">
        <p className="text-xs text-slate-500">
          {summary.encounterDate} · {summary.submittedBy}
          {summary.discipline ? ` · ${summary.discipline}` : ""}
        </p>

        {/*
          Their own sentence first, exactly as the exported PDF orders it. The
          two documents should not disagree about what leads.
        */}
        {summary.clinicianStatement ? (
          <p className="border-l-2 border-[color:var(--nf-accent)] pl-3 text-sm text-slate-800">
            {summary.clinicianStatement}
          </p>
        ) : null}

        {summary.facts.length > 0 ? (
          <dl className="space-y-2">
            {summary.facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  {fact.label}
                </dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-slate-800">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <p className="text-xs leading-relaxed text-slate-500">
          Shown so you are writing a continuation rather than a first draft. Nothing here is
          copied into the form — what is true today is for you to write.
        </p>
      </div>
    </details>
  );
}
