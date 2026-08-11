"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Upload, X } from "lucide-react";
import { uploadPage } from "@/lib/uploads/client";
import { submitPhotoPages, type PhotoState } from "@/lib/intake/photoActions";
import { STATUS_LABEL } from "@/lib/clients/labels";
import ShareOnWhatsApp from "@/components/shared/ShareOnWhatsApp";
import type { ClientStatus } from "@prisma/client";

interface ClientOption {
  id: string;
  clientCode: string;
  /** Name where one was recorded, otherwise initials. The code identifies. */
  label: string;
  status: ClientStatus;
}

interface StagedPage {
  name: string;
  path: string;
  previewUrl: string;
}

/**
 * Photograph-and-upload, in two stages.
 *
 * The images go to Storage *first*, one at a time, as they are chosen — before
 * the form is submitted. That is not a technical convenience, it is what makes
 * this usable on a clinic's wifi: a therapist with six pages sees each one land
 * as it finishes rather than staring at a spinner for two minutes and losing
 * the lot when the connection drops on page five.
 *
 * The submit that follows carries only paths and a date, so it is instant.
 */
export default function PhotoUpload({
  clients,
  defaultWhatsApp,
}: {
  clients: ClientOption[];
  defaultWhatsApp: string;
}) {
  const [staged, setStaged] = useState<StagedPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<PhotoState, FormData>(
    submitPhotoPages,
    {}
  );

  async function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    event.target.value = "";

    setBusy(true);
    setUploadError(null);
    for (const file of files) {
      try {
        const path = await uploadPage(file, "page");
        setStaged((prev) => [
          ...prev,
          { name: file.name, path, previewUrl: URL.createObjectURL(file) },
        ]);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "That page did not upload.");
        break;
      }
    }
    setBusy(false);
  }

  if (state.success) {
    return (
      <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-semibold text-emerald-900">
          {state.success.pages} page{state.success.pages === 1 ? "" : "s"} received.
        </h2>
        <p className="mt-1 text-sm text-emerald-800">
          {state.success.transcribed > 0
            ? `${state.success.transcribed} transcribed automatically. A person checks every transcript against the original before any note is written.`
            : "They will be transcribed by a person before any note is written."}
        </p>
        <ShareOnWhatsApp
          submissionId={state.success.submissionId}
          defaultPhone={defaultWhatsApp}
        />
        <div className="mt-4 flex gap-3 text-sm">
          <Link href="/t/upload" className="font-medium underline">
            Upload another set
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="clientId" className="block text-sm font-medium">
            Client
          </label>
          <select
            id="clientId"
            name="clientId"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.clientCode} · {client.label}
                {client.status !== "ACTIVE" ? ` — ${STATUS_LABEL[client.status]}` : ""}
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
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium">Pages</label>
        <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-400 px-4 py-6 text-sm text-slate-600 hover:bg-slate-50">
          <Upload size={16} />
          {busy ? "Uploading…" : "Take a photo or choose files"}
          <input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            multiple
            onChange={onFiles}
            disabled={busy}
            className="hidden"
          />
        </label>

        {uploadError ? <p className="mt-2 text-sm text-rose-700">{uploadError}</p> : null}

        {staged.length > 0 ? (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {staged.map((page, index) => (
              <li key={page.path} className="relative rounded border border-slate-200 p-1">
                <input type="hidden" name="paths" value={page.path} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.previewUrl}
                  alt={`Page ${index + 1}`}
                  className="h-28 w-full rounded object-cover"
                />
                <span className="mt-1 block truncate text-xs text-slate-500">
                  Page {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setStaged((prev) => prev.filter((p) => p.path !== page.path))}
                  aria-label={`Remove page ${index + 1}`}
                  className="absolute top-1 right-1 rounded bg-white/90 p-0.5 text-slate-600"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <label htmlFor="context" className="block text-sm font-medium">
          Anything the transcriber should know{" "}
          <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <textarea
          id="context"
          name="context"
          rows={3}
          placeholder="e.g. the second page is the risk review; my handwriting for medication names is poor."
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {state.blocked ? (
        <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 p-4">
          <h3 className="text-sm font-semibold text-rose-900">Not filed</h3>
          <p className="mt-1 text-sm text-rose-800">{state.blocked.message}</p>
        </div>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || busy || staged.length === 0}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Submitting…" : `Submit ${staged.length || ""} page${staged.length === 1 ? "" : "s"}`}
      </button>
    </form>
  );
}