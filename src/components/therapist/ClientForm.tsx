"use client";

import { useActionState } from "react";
import { createClient, type ClientFormState } from "@/lib/clients/manage";

/**
 * Adding a client.
 *
 * The name fields carry their own explanation, in the form, at the moment
 * somebody is about to type. A privacy rule that lives only in a policy
 * document is a rule that gets broken by a well-meaning person filling in a box
 * labelled "name" — so the box says what it wants and what happens to it.
 *
 * The surname field accepts one letter. It is truncated server-side regardless,
 * but showing the constraint here means nobody types a full surname and assumes
 * it was kept.
 */
export default function ClientForm({
  therapists,
  canAssign,
  namesAvailable,
}: {
  therapists: { id: string; fullName: string }[];
  canAssign: boolean;
  namesAvailable: boolean;
}) {
  const [state, formAction, pending] = useActionState<ClientFormState, FormData>(
    createClient,
    {}
  );

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <div>
        <label htmlFor="clientCode" className="block text-sm font-medium">
          Client code <span className="text-rose-600">*</span>
        </label>
        <input
          id="clientCode"
          name="clientCode"
          required
          placeholder="RVN-0142"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-500">
          Your practice&apos;s own identifier. This is what appears on every screen, every
          filename and every export — the name never does the identifying.
        </p>
      </div>

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">Name</legend>
        <p className="text-xs text-slate-500">
          {namesAvailable
            ? "So you can tell which client is which. The first name is encrypted before it is stored — it is unreadable in the database, in a backup, and to anyone with the database password. Only the surname's first letter is kept."
            : "Unavailable on this deployment: FIELD_ENCRYPTION_KEY is not set, so names cannot be stored securely and will not be accepted."}
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr]">
          <label className="block text-sm">
            First name
            <input
              name="givenName"
              disabled={!namesAvailable}
              placeholder="Maria"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            />
          </label>
          <label className="block text-sm">
            Surname initial
            <input
              name="familyInitial"
              maxLength={1}
              disabled={!namesAvailable}
              placeholder="D"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
            />
            <span className="mt-1 block text-xs text-slate-500">One letter only.</span>
          </label>
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Birth year <span className="font-normal text-slate-500">(optional)</span>
          <input
            name="birthYear"
            type="number"
            min={1900}
            max={new Date().getFullYear()}
            placeholder="1988"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Year only — a full date of birth is a direct identifier and is not collected.
          </span>
        </label>

        {canAssign ? (
          <label className="block text-sm">
            Clinician
            <select
              name="primaryTherapistId"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {therapists.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add client"}
      </button>
    </form>
  );
}
