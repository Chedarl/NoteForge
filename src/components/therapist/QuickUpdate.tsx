"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { submitQuickBatch, type QuickBatchState } from "@/lib/intake/quickActions";

/**
 * The write-and-send screen.
 *
 * Modelled on the page a clinician actually produces: a round of clients seen
 * in one sitting, each headed by a name — "Smith J" — with a short paragraph
 * underneath in their own shorthand. So this screen takes as many clients as
 * they saw, not one, and sends the whole round as a single document.
 *
 * One entry and six entries are the same code path. A separate "single" screen
 * would be a second way to do the same thing, and the two would drift.
 *
 * Entries are held in local state rather than being added on the server, so
 * nothing is written until the round is sent — a half-typed round is not
 * something a note writer should be able to receive. Existing clients are
 * offered through a native `<datalist>`: one element, no JavaScript, and on a
 * phone it produces the platform's own picker.
 */

export interface QuickClient {
  id: string;
  label: string;
  code: string;
}

interface Entry {
  key: number;
  name: string;
  narrative: string;
}

const initial: QuickBatchState = {};

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

let nextKey = 1;

export function QuickUpdate({
  clients,
  noteWriterNumber,
  whatsappReady,
  canSaveDefault,
}: {
  clients: QuickClient[];
  noteWriterNumber: string | null;
  whatsappReady: boolean;
  /** Only an owner may change where the whole practice's documents go. */
  canSaveDefault: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitQuickBatch, initial);
  const [occurredAt, setOccurredAt] = useState(nowLocal);
  const [entries, setEntries] = useState<Entry[]>([{ key: 0, name: "", narrative: "" }]);

  const update = (key: number, patch: Partial<Entry>) =>
    setEntries((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  if (state.success) {
    const { filed, refused, filename, downloadIds, whatsapp } = state.success;
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
              {filed.length} update{filed.length === 1 ? "" : "s"} saved
            </h2>
            <p className="mt-0.5 text-sm text-slate-700">
              {whatsapp === null
                ? "The PDF is ready. WhatsApp delivery isn't set up here, so download it below."
                : whatsapp.message}
            </p>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          {filed.length > 0 && (
            <ul className="space-y-1.5">
              {filed.map((entry) => (
                <li key={entry.clientCode} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium text-slate-900">{entry.name}</span>
                  <span className="font-mono text-xs text-slate-500">{entry.clientCode}</span>
                  {entry.created && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      new client
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {refused.length > 0 && (
            <div className="rounded-[var(--nf-radius)] border border-amber-300 bg-amber-50 px-4 py-3.5">
              <p className="text-sm font-semibold text-amber-900">
                {refused.length} not filed
              </p>
              <ul className="mt-1.5 space-y-1.5 text-sm text-amber-900">
                {refused.map((entry, i) => (
                  <li key={i}>
                    <span className="font-medium">{entry.name}</span> — {entry.problem}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-800">
                Anything refused on a client&rsquo;s status has still been kept and flagged for
                the practice to reconcile. It has not been thrown away.
              </p>
            </div>
          )}

          {filename && (
            <div>
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                Document
              </p>
              <p className="mt-1 font-mono text-xs break-all text-slate-700">{filename}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2.5 pt-1">
            {downloadIds.length > 0 && (
              <a
                href={`/api/export/submission/${downloadIds[0]}`}
                target="_blank"
                rel="noopener"
                className="nf-btn nf-btn-primary"
              >
                {downloadIds.length > 1 ? "Open the first PDF" : "Open the PDF"}
              </a>
            )}
            <a href="/t/write" className="nf-btn nf-btn-quiet">
              Start another round
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
        <p className="rounded-[var(--nf-radius)] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {state.error}
        </p>
      )}

      <div className="nf-card px-5 py-4">
        <label htmlFor="occurredAt" className="nf-label">
          When you saw them
        </label>
        <input
          id="occurredAt"
          name="occurredAt"
          type="datetime-local"
          required
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          className="nf-field sm:max-w-xs"
        />
        <p className="nf-hint">Applies to every client in this round. Defaults to now.</p>
      </div>

      <datalist id="nf-clients">
        {clients.map((client) => (
          <option key={client.id} value={client.label}>
            {client.code}
          </option>
        ))}
      </datalist>

      {entries.map((entry, index) => (
        <div key={entry.key} className="nf-surface overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[color:var(--nf-border)] px-5 py-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              {index + 1}
            </span>
            <input
              name="clientName"
              list="nf-clients"
              required
              autoComplete="off"
              placeholder="Smith J"
              aria-label={`Client ${index + 1}`}
              value={entry.name}
              onChange={(e) => update(entry.key, { name: e.target.value })}
              className="nf-field flex-1 font-medium"
            />
            {entries.length > 1 && (
              <button
                type="button"
                onClick={() => setEntries((rows) => rows.filter((r) => r.key !== entry.key))}
                className="shrink-0 rounded-full px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={`Remove client ${index + 1}`}
              >
                Remove
              </button>
            )}
          </div>

          <div className="px-5 py-4">
            <textarea
              name="narrative"
              rows={8}
              required
              aria-label={`Update for client ${index + 1}`}
              placeholder={
                "Pt reports sleeping better since the medication change, mood fair.\nDenies SI/HI/AVH. Endorses 7–8 cig daily, denies SUD or alcohol.\nRequested refill. Denies ER visit."
              }
              value={entry.narrative}
              onChange={(e) => update(entry.key, { narrative: e.target.value })}
              className="nf-writing"
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          setEntries((rows) => [...rows, { key: nextKey++, name: "", narrative: "" }])
        }
        className="nf-btn nf-btn-quiet w-full border-dashed sm:w-auto"
      >
        + Add another client
      </button>

      <p className="nf-hint">
        Your own shorthand is fine. Include risk and any medication change explicitly — the
        note is written from this, so anything left out cannot be recovered later.
      </p>

      {whatsappReady && (
        <div className="rounded-[var(--nf-radius)] border border-[color:var(--nf-border)] bg-white px-4 py-3.5">
          {/* An ordinary editable field, not a setting two screens away. Cover
              arrangements and second note writers are normal; none of them
              should need an administrator. */}
          <label htmlFor="sendTo" className="nf-label">
            Send to
          </label>
          <input
            id="sendTo"
            name="sendTo"
            type="tel"
            defaultValue={noteWriterNumber ?? ""}
            placeholder="+1 415 555 0123"
            className="nf-field"
          />
          <p className="nf-hint">
            {noteWriterNumber
              ? "Prefilled with your usual note writer. Change it to send this one somewhere else."
              : "Any WhatsApp number, with its country code."}
          </p>

          {canSaveDefault && (
            <label className="mt-2.5 flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="saveDefault"
                className="size-4 accent-[color:var(--nf-accent)]"
              />
              <span className="text-slate-700">Remember this as the usual number</span>
            </label>
          )}

          <label className="mt-3 flex cursor-pointer items-start gap-2.5 border-t border-[color:var(--nf-border)] pt-3 text-sm">
            <input
              type="checkbox"
              name="includeName"
              className="mt-0.5 size-4 accent-[color:var(--nf-accent)]"
            />
            <span className="text-slate-700">
              Include client names in the PDF
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
              ? `Save and send ${entries.length > 1 ? `${entries.length} updates` : "the PDF"}`
              : "Save and make the PDF"}
        </button>
        <span className="text-xs text-slate-500">
          {entries.length > 1
            ? "All of them go as one PDF, a page per client."
            : "Saved with the date and time, then turned into a PDF."}
        </span>
      </div>
    </form>
  );
}
