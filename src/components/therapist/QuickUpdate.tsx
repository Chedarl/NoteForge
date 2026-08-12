"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { submitQuickUpdate, type QuickUpdateState } from "@/lib/intake/quickActions";

/**
 * The write-and-send screen.
 *
 * Modelled on what the clinicians this replaces actually do: a page headed with
 * a name — "Smith J" — and a short paragraph underneath in their own shorthand.
 * So the client is a **name you type**, not a record you create first, and the
 * writing surface is the screen rather than one field among several.
 *
 * Typing a name that already exists finds that client; a new one is created with
 * the next practice code. Nothing is weakened by that — the guardrail, the audit
 * trail and duplicate detection all run identically either way — and it removes
 * the one step the paper process does not have.
 *
 * The existing clients are offered through a native `<datalist>` rather than a
 * custom autocomplete. It is one element, it needs no JavaScript, and on a phone
 * it produces the platform's own picker, which is faster than anything that
 * could be built here and is already familiar.
 */

export interface QuickClient {
  id: string;
  label: string;
  code: string;
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
  noteWriterNumber: string | null;
  whatsappReady: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitQuickUpdate, initial);
  const [occurredAt, setOccurredAt] = useState(nowLocal);
  const [showSendTo, setShowSendTo] = useState(false);

  if (state.success) {
    const { whatsapp, filename, flagged, submissionId, client } = state.success;
    return (
      <div className="nf-card mt-8 overflow-hidden">
        <div className="flex items-start gap-3 border-b border-[color:var(--nf-border)] bg-[color:var(--nf-accent-wash)] px-6 py-5">
          <span
            aria-hidden
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--nf-accent)] text-sm font-bold text-white"
          >
            ✓
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Saved for {client.label}
            </h2>
            <p className="mt-0.5 text-sm text-slate-700">
              {whatsapp === null
                ? "Your PDF is ready. WhatsApp delivery isn't set up here, so download it below."
                : whatsapp.message}
            </p>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-sm text-slate-600">
            Filed under{" "}
            <span className="font-mono font-medium text-slate-900">{client.code}</span>
            {client.created ? " — a new client record, created just now." : "."}
          </p>

          {flagged && (
            <p className="rounded-[--nf-radius] bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
              This looks similar to something already submitted for this client, so it has
              been flagged for a person to check before anything is written twice.
            </p>
          )}

          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Document
            </p>
            <p className="mt-1 font-mono text-xs break-all text-slate-700">{filename}</p>
          </div>

          <div className="flex flex-wrap gap-2.5 pt-1">
            <a
              href={`/api/export/submission/${submissionId}`}
              target="_blank"
              rel="noopener"
              className="nf-btn nf-btn-primary"
            >
              Open the PDF
            </a>
            <a href="/t/write" className="nf-btn nf-btn-quiet">
              Write the next one
            </a>
            <Link href="/t" className="nf-btn nf-btn-quiet">
              My clients
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-5">
      {state.error && (
        <p className="rounded-[--nf-radius] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {state.error}
        </p>
      )}

      {state.blocked && (
        <div className="rounded-[--nf-radius] border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm text-amber-900">
          <p className="font-semibold">{state.blocked.message}</p>
          <p className="mt-1">
            What you wrote has been kept and flagged for someone to reconcile — it has not
            been thrown away. Nothing more is needed from you right now.
          </p>
        </div>
      )}

      {/* The writing surface. One card, so the eye goes to the box and not to a
          form. The header row carries the two things that must be right and
          nothing else. */}
      <div className="nf-surface overflow-hidden">
        <div className="grid gap-4 border-b border-[color:var(--nf-border)] px-5 py-4 sm:grid-cols-[1.4fr_1fr]">
          <div>
            <label htmlFor="clientName" className="nf-label">
              Client
            </label>
            <input
              id="clientName"
              name="clientName"
              list="nf-clients"
              required
              autoComplete="off"
              placeholder="Smith J"
              className="nf-field font-medium"
            />
            <datalist id="nf-clients">
              {clients.map((client) => (
                <option key={client.id} value={client.label}>
                  {client.code}
                </option>
              ))}
            </datalist>
            <p className="nf-hint">
              Write the name as you always do. New ones are created automatically.
            </p>
          </div>

          <div>
            <label htmlFor="occurredAt" className="nf-label">
              When
            </label>
            <input
              id="occurredAt"
              name="occurredAt"
              type="datetime-local"
              required
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="nf-field"
            />
            <p className="nf-hint">Defaults to now.</p>
          </div>
        </div>

        <div className="px-5 py-4">
          <label htmlFor="narrative" className="nf-label">
            The update
          </label>
          <textarea
            id="narrative"
            name="narrative"
            rows={14}
            required
            placeholder={
              "Pt reports sleeping better since the medication change, mood fair.\nDenies SI/HI/AVH. Endorses 7–8 cig daily, denies SUD or alcohol.\nRequested refill. Denies ER visit."
            }
            className="nf-writing"
          />
          <p className="nf-hint">
            Your own shorthand is fine. Include risk and any medication change explicitly —
            the note is written from this, so anything left out cannot be recovered later.
          </p>
        </div>
      </div>

      {whatsappReady && (
        <div className="rounded-[--nf-radius] border border-[color:var(--nf-border)] bg-white px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">
              {noteWriterNumber ? (
                <>
                  Sending to <span className="font-medium">{noteWriterNumber}</span>
                </>
              ) : (
                "No note-writer number is set for this practice."
              )}
            </p>
            <button
              type="button"
              onClick={() => setShowSendTo((v) => !v)}
              className="text-sm font-medium text-[color:var(--nf-accent)] underline-offset-2 hover:underline"
            >
              {showSendTo ? "Use the usual number" : "Send somewhere else"}
            </button>
          </div>

          {showSendTo && (
            <div className="mt-3">
              <label htmlFor="sendTo" className="nf-label">
                WhatsApp number for this update
              </label>
              <input
                id="sendTo"
                name="sendTo"
                type="tel"
                placeholder="+1 415 555 0123"
                className="nf-field"
              />
              <p className="nf-hint">
                Used for this send only — it is not saved over the practice&rsquo;s number.
              </p>
            </div>
          )}

          <label className="mt-3 flex cursor-pointer items-start gap-2.5 border-t border-[color:var(--nf-border)] pt-3 text-sm">
            <input
              type="checkbox"
              name="includeName"
              className="mt-0.5 size-4 accent-[color:var(--nf-accent)]"
            />
            <span className="text-slate-700">
              Include the client&rsquo;s name in the PDF
              <span className="nf-hint mt-0.5 block">
                Off by default — the document is identified by client code. WhatsApp is not
                a protected channel, so a named document stays in that chat and its backups.
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="nf-btn nf-btn-primary w-full sm:w-auto">
          {pending
            ? "Saving…"
            : whatsappReady
              ? "Save and send the PDF"
              : "Save and make the PDF"}
        </button>
        <span className="text-xs text-slate-500">
          Saved with the date and time, then turned into a PDF.
        </span>
      </div>
    </form>
  );
}
