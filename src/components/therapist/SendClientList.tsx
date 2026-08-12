"use client";

import { useActionState, useState } from "react";
import { sendClientRoster, type RosterState } from "@/lib/clients/roster";

/**
 * "Tell the practice who is still open."
 *
 * Collapsed by default: this sits above a caseload a clinician is usually here
 * to read, and a permanently expanded form with a send button would be noise
 * ninety-nine visits out of a hundred.
 *
 * The two choices are the two that change what leaves the building — whether
 * names are on it, and whether it is the open cases or everybody — and both
 * default to the smaller disclosure.
 */

const initial: RosterState = {};

export default function SendClientList({
  noteWriterNumber,
  whatsappReady,
  clientCount,
  activeCount,
}: {
  noteWriterNumber: string | null;
  whatsappReady: boolean;
  clientCount: number;
  activeCount: number;
}) {
  const [state, formAction, pending] = useActionState(sendClientRoster, initial);
  const [open, setOpen] = useState(false);

  if (state.success) {
    const { whatsapp, filename, total, active } = state.success;
    return (
      <div className="nf-card mb-6 border-[color:var(--nf-accent)] px-5 py-4">
        <p className="font-semibold text-slate-900">
          Client list sent — {active} active of {total}
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {whatsapp === null
            ? "WhatsApp delivery isn't set up on this deployment, so nothing was sent."
            : whatsapp.message}
        </p>
        <p className="mt-2 font-mono text-xs break-all text-slate-500">{filename}</p>
      </div>
    );
  }

  return (
    <div className="nf-card mb-6 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">Send your client list</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {activeCount} of {clientCount} accepting new notes. Sends a PDF so the practice
            knows who is still open.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="nf-btn nf-btn-quiet"
        >
          {open ? "Cancel" : "Send list"}
        </button>
      </div>

      {open && (
        <form action={formAction} className="mt-4 space-y-3 border-t border-[color:var(--nf-border)] pt-4">
          {state.error && (
            <p className="rounded-[var(--nf-radius)] border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
              {state.error}
            </p>
          )}

          {whatsappReady && (
            <div>
              <label htmlFor="rosterSendTo" className="nf-label">
                Send to
              </label>
              <input
                id="rosterSendTo"
                name="sendTo"
                type="tel"
                defaultValue={noteWriterNumber ?? ""}
                placeholder="+1 415 555 0123"
                className="nf-field"
              />
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              name="activeOnly"
              defaultChecked
              className="size-4 accent-[color:var(--nf-accent)]"
            />
            <span className="text-slate-700">Only the clients still accepting notes</span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="includeNames"
              className="mt-0.5 size-4 accent-[color:var(--nf-accent)]"
            />
            <span className="text-slate-700">
              Include names
              <span className="nf-hint mt-0.5 block">
                Off by default. A list of everyone you see is a larger disclosure than any
                single session — WhatsApp is not a protected channel.
              </span>
            </span>
          </label>

          <button disabled={pending} className="nf-btn nf-btn-primary w-full sm:w-auto">
            {pending ? "Sending…" : whatsappReady ? "Send the list" : "Make the list"}
          </button>
        </form>
      )}
    </div>
  );
}
