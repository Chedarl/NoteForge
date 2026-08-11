"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { submitQuickUpdate, type QuickUpdateState } from "@/lib/intake/quickActions";
import { STATUS_LABEL } from "@/lib/clients/labels";
import type { ClientStatus } from "@prisma/client";

/**
 * The write-and-send screen.
 *
 * One box. The design constraint is that a clinician standing in a corridor
 * between visits can finish this in under a minute on a phone, so everything
 * that could be defaulted is defaulted: the date and time are now, the template
 * is implied, and the only two decisions are which client and what happened.
 *
 * The client picker still shows status, and a non-active client is still
 * offered rather than hidden. Hiding them would teach clinicians that the list
 * is the source of truth about who can be written about — and the whole point
 * of the guardrail is that the *server* decides that, at the moment of writing,
 * because the list on a loaded page is already out of date.
 */

export interface QuickClient {
  id: string;
  label: string;
  status: ClientStatus;
}

const initial: QuickUpdateState = {};

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function QuickUpdate({
  clients,
  noteWriterNumber,
  whatsappReady,
}: {
  clients: QuickClient[];
  /** The practice's note writer. Null until an owner sets one. */
  noteWriterNumber: string | null;
  whatsappReady: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitQuickUpdate, initial);
  const [occurredAt, setOccurredAt] = useState(nowLocal);

  if (state.success) {
    const { whatsapp, filename, flagged, submissionId } = state.success;
    return (
      <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-semibold text-emerald-900">Saved.</h2>

        <p className="mt-1 text-sm text-emerald-800">
          {whatsapp === null
            ? "The PDF is ready. WhatsApp delivery is not set up on this deployment, so download it below."
            : whatsapp.message}
        </p>

        {flagged && (
          <p className="mt-2 text-sm text-emerald-800">
            It looks similar to something already submitted for this client, so it has been
            flagged for a person to check before anything is written twice.
          </p>
        )}

        <p className="mt-3 font-mono text-xs break-all text-emerald-900">{filename}</p>

        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <a
            href={`/api/export/submission/${submissionId}`}
            target="_blank"
            rel="noopener"
            className="font-medium underline"
          >
            Open the PDF
          </a>
          <a href="/t/write" className="font-medium underline">
            Write another
          </a>
          <Link href="/t" className="font-medium underline">
            Back to my clients
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-5">
      {state.error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {state.error}
        </p>
      )}

      {state.blocked && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">{state.blocked.message}</p>
          <p className="mt-1">
            What you wrote has been kept and flagged for someone to reconcile — it has not
            been thrown away. Nothing more is needed from you right now.
          </p>
        </div>
      )}

      <div>
        <label htmlFor="clientId" className="block text-sm font-medium">
          Client
        </label>
        <select
          id="clientId"
          name="clientId"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.label}
              {client.status === "ACTIVE" ? "" : ` — ${STATUS_LABEL[client.status]}`}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="occurredAt" className="block text-sm font-medium">
          When it happened
        </label>
        <input
          id="occurredAt"
          name="occurredAt"
          type="datetime-local"
          required
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-500">
          Defaults to now. Change it if you are writing this up later — the date and time of
          the encounter is what the note gets written against, not when you typed it.
        </p>
      </div>

      <div>
        <label htmlFor="narrative" className="block text-sm font-medium">
          What did you discuss?
        </label>
        <textarea
          id="narrative"
          name="narrative"
          rows={12}
          required
          placeholder="Write it as you would say it. What they reported, what you observed, what you did, what happens next. Include risk and any medication change explicitly."
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-500">
          Plain sentences are fine. This is the source a note gets written from, so anything
          you leave out cannot be recovered later.
        </p>
      </div>

      {whatsappReady && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="includeName" className="mt-0.5" />
            <span>
              Put the client&rsquo;s name in the PDF.
              <span className="mt-0.5 block text-xs text-slate-600">
                Off by default. The document is identified by client code, which is enough to
                match against your own records. WhatsApp is not a protected channel — a named
                document stays in that chat history and in its backups.
              </span>
            </span>
          </label>
          <p className="mt-2 text-xs text-slate-500">
            {noteWriterNumber
              ? `Sending to the note writer on ${noteWriterNumber}.`
              : "No note-writer number is set for this practice yet, so nothing will send — the PDF is still saved and downloadable."}
          </p>
        </div>
      )}

      <button
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Saving…" : whatsappReady ? "Save and send the PDF" : "Save and make the PDF"}
      </button>
    </form>
  );
}
