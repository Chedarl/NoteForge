"use client";

import TemplateFieldInput from "@/components/shared/TemplateField";
import TemplateSections from "@/components/shared/TemplateSections";
import type { NeedDefinition } from "@/lib/intake/needs";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { submitStructuredNote, type IntakeState } from "@/lib/intake/actions";
import { TEMPLATES } from "@/lib/intake/templates";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { STATUS_LABEL } from "@/lib/clients/labels";
import { StatusBadge } from "@/components/shared/ui";
import ShareOnWhatsApp from "@/components/shared/ShareOnWhatsApp";
import type { ClientStatus, Discipline, TemplateKind } from "@prisma/client";

interface ClientOption {
  id: string;
  clientCode: string;
  /** "Maria D." where a name was recorded, otherwise initials. Never the identifier. */
  label: string;
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
  preselectedTemplate,
  allowedTemplates,
  discipline,
  defaultWhatsApp,
  needs,
}: {
  clients: ClientOption[];
  preselectedClientId: string;
  /**
   * Which template to open on, from the dashboard's primary action — a nurse
   * practitioner pressing "Start a clinical encounter" should land on the
   * nursing form, not on whatever happens to be first.
   *
   * Validated by the caller against `allowedTemplates`: setting this to a
   * template the select cannot offer would leave the form in a state with no
   * matching option, which renders as an empty dropdown rather than an error.
   */
  preselectedTemplate?: TemplateKind;
  /** Templates for this clinician's discipline, most appropriate first. */
  allowedTemplates: TemplateKind[];
  discipline: Discipline;
  defaultWhatsApp: string;
  /** Standard needs plus whatever this practice has added. Resolved server-side. */
  needs: NeedDefinition[];
}) {
  const [clientId, setClientId] = useState(preselectedClientId || clients[0]?.id || "");
  const [templateKind, setTemplateKind] = useState<TemplateKind>(
    preselectedTemplate ?? allowedTemplates[0]
  );
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
        <ShareOnWhatsApp
          submissionId={state.success.submissionId}
          defaultPhone={defaultWhatsApp}
        />
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
              {client.clientCode} · {client.label}
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
            {allowedTemplates.map((kind) => (
              <option key={kind} value={kind}>
                {TEMPLATES[kind].name} — {TEMPLATES[kind].description}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Filed as {DISCIPLINE_LABEL[discipline]}. That is recorded on this note and
            travels with it, so the right kind of note gets written from it.
          </p>
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
      <TemplateSections
        fields={template.fields}
        collapseOnPhone
        // A required field the server refused is not much use inside a section
        // the clinician has collapsed and cannot see.
        openEverything={Boolean(state.missing?.length)}
        renderField={(field) => (
          <TemplateFieldInput key={field.id} field={field} needs={needs} />
        )}
      />

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