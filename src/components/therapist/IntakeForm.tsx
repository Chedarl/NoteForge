"use client";

import TemplateFieldInput from "@/components/shared/TemplateField";
import TemplateSections from "@/components/shared/TemplateSections";
import PreviousSubmission from "@/components/therapist/PreviousSubmission";
import { useFormDraft } from "@/lib/forms/draft";
import type { NeedDefinition } from "@/lib/intake/needs";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { submitStructuredNote, type IntakeState } from "@/lib/intake/actions";
import { TEMPLATES, readField } from "@/lib/intake/templates";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { STATUS_LABEL } from "@/lib/clients/labels";
import { StatusBadge } from "@/components/shared/ui";
import ShareOnWhatsApp from "@/components/shared/ShareOnWhatsApp";
import type { ClientStatus, Discipline, TemplateKind } from "@prisma/client";
import type { PreviousSummary } from "@/lib/intake/previous";

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
  capped,
  preselectedClientId,
  previous,
  preselectedTemplate,
  allowedTemplates,
  discipline,
  defaultWhatsApp,
  needs,
}: {
  clients: ClientOption[];
  /**
   * True when the caseload is bigger than the picker is showing. Said out loud
   * rather than left to be discovered: a clinician hunting for a client who is
   * not in the list concludes the system has lost them.
   */
  capped: boolean;
  preselectedClientId: string;
  /**
   * The last encounter for whichever client the page opened on, resolved on the
   * server so it is present at first paint. Changing the client fetches the
   * next one.
   */
  previous: PreviousSummary | null;
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

  /*
   * What was typed, kept across a refused submit.
   *
   * React resets an uncontrolled form once its action completes. That is
   * reasonable for a form that succeeded and ruinous for one the server sent
   * back: a nurse practitioner fills in twenty fields, leaves one empty, and
   * loses all twenty along with the error message telling her which. It was
   * survivable when this form was five textareas. It is not now.
   *
   * So every submit snapshots the answers and bumps `attempt`, which re-keys
   * the field block. Remounting is what makes it work — `defaultValue` is only
   * read when a control mounts, so a re-render alone would not put the text
   * back. Controlling twenty fields by hand would mean a state update per
   * keystroke on a phone, for no benefit the moment the reset is handled.
   *
   * Found by filling the form in a browser and pressing the button. Lint,
   * typecheck and a build were all green over it, and so was every check that
   * drove the action directly instead of through a form.
   */
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [attempt, setAttempt] = useState(0);

  /*
   * The same field block serves both recoveries, and that is why they share
   * `draft` and `attempt`: a restored autosave and a bounced-back submission
   * are the same problem — put answers back into an uncontrolled form — and two
   * mechanisms for it would drift.
   *
   * Keyed by client and template, so a draft can never be silently reattached
   * to a different person.
   */
  const saved = useFormDraft(
    clientId ? `${clientId}:${templateKind}` : null,
    // Which of this template's fields hold a list. See the note on the hook:
    // `FormData` cannot tell one ticked box from one text field.
    useMemo(
      () =>
        new Set(
          TEMPLATES[templateKind].fields
            .filter((field) => field.type === "multi")
            .map((field) => field.id)
        ),
      [templateKind]
    )
  );

  useEffect(() => {
    if (!saved.restored) return;
    setDraft(saved.restored as Record<string, unknown>);
    setAttempt((n) => n + 1);
  }, [saved.restored]);

  // Filed means there is nothing left to recover.
  useEffect(() => {
    if (state.success) saved.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  const rememberAnswers = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const answers: Record<string, unknown> = {};
    // Through `readField`, so a checkbox group comes back as the array it is
    // rather than as its first ticked box.
    for (const field of TEMPLATES[templateKind].fields) {
      answers[field.id] = readField(field, data);
    }
    setDraft(answers);
    setAttempt((n) => n + 1);
  };

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
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {/*
            Their own copy, without minting a public link.
            The route has always allowed this — a therapist is an accepted role
            and is scoped to their own submissions — but nothing on this screen
            pointed at it, so a clinician who simply wanted the PDF was pushed
            into creating an expiring link for a stranger to open. The quick
            path at /t/write has offered this all along; the structured form is
            where the specification claimed it and it was not there.
          */}
          <a
            href={`/api/export/submission/${state.success.submissionId}`}
            className="font-medium underline"
          >
            Download the PDF
          </a>
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
    <form
      action={formAction}
      onSubmit={(event) => rememberAnswers(event.currentTarget)}
      onChange={(event) => saved.capture(event.currentTarget)}
      onInput={(event) => saved.capture(event.currentTarget)}
      className="mt-6 space-y-6"
    >
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

        {capped ? (
          <p className="mt-1 text-xs text-slate-500">
            Showing your most recently seen clients. If somebody is not here, find them on{" "}
            <Link href="/t/clients" className="font-medium underline">
              your caseload
            </Link>{" "}
            and press Write note — the form opens with them already chosen.
          </p>
        ) : null}

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

        {/*
          What was recorded last time, under the client and above the form.
          Placed here on purpose: after you have chosen who, before you have
          started writing. Further down and it is read after the fact; further
          up and it is describing a client nobody has picked yet.
        */}
        <PreviousSubmission clientId={clientId} initial={previous} />
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

      {saved.available ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            You have an unsent draft for this client.
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            Saved on this device at{" "}
            {saved.available.savedAt.toLocaleString("en-GB", {
              dateStyle: "short",
              timeStyle: "short",
            })}
            . It has not been filed.
          </p>
          <div className="mt-2 flex gap-3 text-sm">
            <button
              type="button"
              onClick={saved.restore}
              className="font-medium text-amber-900 underline"
            >
              Put it back
            </button>
            <button
              type="button"
              onClick={saved.discard}
              className="font-medium text-amber-800 underline"
            >
              Discard it
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Template fields ────────────────────────────────────────────── */}
      <TemplateSections
        key={`${templateKind}-${attempt}`}
        fields={template.fields}
        collapseOnPhone
        // A required field the server refused is not much use inside a section
        // the clinician has collapsed and cannot see.
        openEverything={Boolean(state.missing?.length)}
        renderField={(field) => (
          <TemplateFieldInput
            key={field.id}
            field={field}
            value={draft[field.id]}
            needs={needs}
          />
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
          {saved.savedAt ? (
            <span className="block text-slate-400">
              Draft kept on this device, not sent.
            </span>
          ) : null}
        </span>
      </div>
    </form>
  );
}