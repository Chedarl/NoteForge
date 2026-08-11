"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { submitStructuredNote, type IntakeState } from "@/lib/intake/actions";
import { TEMPLATE_LIST, TEMPLATES } from "@/lib/intake/templates";
import { STATUS_LABEL } from "@/lib/clients/labels";
import Dictate from "@/components/therapist/Dictate";
import { StatusBadge } from "@/components/shared/ui";
import type { ClientStatus, TemplateKind } from "@prisma/client";

interface ClientOption {
  id: string;
  clientCode: string;
  initials: string;
  status: ClientStatus;
  statusReason: string | null;
  statusChangedAt: Date;
}

/**
 * The structured intake form — the path this product wants every therapist on.
 *
 * Two things earn that:
 *
 *  - **The client picker states the status before anything is typed.** A
 *    non-active client is selectable but visibly refused, with the reason and
 *    the date, so a clinician learns about a status change at the moment it
 *    matters instead of receiving a rejection later. The server checks again at
 *    write time; this is the courtesy, not the rule.
 *  - **Dictation on every field.** The realistic alternative to typing is not
 *    "typing more carefully", it is reaching for paper. Speech recognition is
 *    built into the browser, costs nothing, and never leaves the device on
 *    desktop Chrome and Safari.
 */
export default function IntakeForm({
  clients,
  preselectedClientId,
}: {
  clients: ClientOption[];
  preselectedClientId: string;
}) {
  const [clientId, setClientId] = useState(preselectedClientId || clients[0]?.id || "");
  const [templateKind, setTemplateKind] = useState<TemplateKind>("SOAP");
  const [state, formAction, pending] = useActionState<IntakeState, FormData>(
    submitStructuredNote,
    {}
  );

  const selected = useMemo(
    () => clients.find((c) => c.id === clientId),
    [clients, clientId]
  );
  const template = TEMPLATES[templateKind];
  const blockedInPicker = selected && selected.status !== "ACTIVE";

  if (state.success) {
    return (
      <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-semibold text-emerald-900">Received.</h2>
        <p className="mt-1 text-sm text-emerald-800">
          It is in the production queue now.
          {state.success.flagged
            ? " It looks similar to something already submitted for this client, so it has been flagged for a person to check before anything is typed twice."
            : ""}
        </p>
        <div className="mt-4 flex gap-3 text-sm">
          <Link href="/t/new" className="font-medium underline">
            Write another
          </Link>
          <Link href="/t" className="font-medium underline">
            Back to my clients
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 space-y-6">
      {/* ── Client ─────────────────────────────────────────────────────── */}
      <div>
        <label htmlFor="clientId" className="block text-sm font-medium">
          Client
        </label>
        <select
          id="clientId"
          name="clientId"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.clientCode} · {client.initials}
              {client.status !== "ACTIVE" ? ` — ${STATUS_LABEL[client.status]}` : ""}
            </option>
          ))}
        </select>

        {blockedInPicker ? (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={selected.status} />
              <span className="font-medium text-amber-900">
                This client does not accept new notes.
              </span>
            </div>
            <p className="mt-1 text-amber-800">
              Since {new Date(selected.statusChangedAt).toLocaleDateString("en-GB")}
              {selected.statusReason ? ` — ${selected.statusReason}` : ""}. You can still
              submit; it will be kept and flagged for the practice to reconcile, but no note
              will be produced.
            </p>
          </div>
        ) : null}
      </div>

      {/* ── Template and date ──────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="templateKind" className="block text-sm font-medium">
            Template
          </label>
          <select
            id="templateKind"
            name="templateKind"
            value={templateKind}
            onChange={(e) => setTemplateKind(e.target.value as TemplateKind)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {TEMPLATE_LIST.map((t) => (
              <option key={t.kind} value={t.kind}>
                {t.name} — {t.description}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="encounterDate" className="block text-sm font-medium">
            Session date
          </label>
          <input
            id="encounterDate"
            name="encounterDate"
            type="date"
            required
            max={new Date().toISOString().slice(0, 10)}
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            When the session happened, not today — this is what duplicate detection compares.
          </p>
        </div>
      </div>

      {/* ── Template fields ────────────────────────────────────────────── */}
      <div className="space-y-4">
        {template.fields.map((field) => (
          <div key={field.id}>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={field.id} className="block text-sm font-medium">
                {field.label}
                {field.required ? <span className="text-rose-600"> *</span> : null}
              </label>
              <Dictate targetId={field.id} />
            </div>
            <p className="text-xs text-slate-500">{field.hint}</p>
            <textarea
              id={field.id}
              name={field.id}
              rows={field.rows}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-relaxed"
            />
          </div>
        ))}
      </div>

      {state.blocked ? (
        <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 p-4">
          <h3 className="text-sm font-semibold text-rose-900">Not filed</h3>
          <p className="mt-1 text-sm text-rose-800">{state.blocked.message}</p>
          <p className="mt-2 text-xs text-rose-700">
            What you wrote has been kept and the practice has been notified — nothing is lost.
          </p>
        </div>
      ) : null}

      {state.error ? (
        <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 p-3">
          <p className="text-sm text-rose-800">{state.error}</p>
          {state.missing?.length ? (
            <p className="mt-1 text-sm text-rose-700">Still needed: {state.missing.join(", ")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Sending…" : "Submit note"}
        </button>
        <span className="text-xs text-slate-500">
          Checked for duplicates and status the moment it arrives.
        </span>
      </div>
    </form>
  );
}
