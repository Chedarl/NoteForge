"use client";

import { useActionState } from "react";
import { unlockShare, type UnlockState } from "@/app/share/[token]/unlock";

/**
 * The code question, on the recipient's side.
 *
 * Deliberately plain. The person seeing this is usually a note writer on a
 * phone, mid-round, who has been told six digits over the phone — so it is one
 * field, a big keypad, and nothing else to read.
 *
 * `inputMode="numeric"` rather than `type="number"`: a number input on a phone
 * brings up a keypad *and* a spinner, strips leading zeros, and will happily
 * accept `1e5`. A passcode is a string of digits, not a quantity.
 */
export default function ShareUnlockForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<UnlockState, FormData>(unlockShare, {});

  if (state.locked) {
    return (
      <div role="alert" className="mt-6 rounded-lg border border-rose-300 bg-rose-50 p-4">
        <p className="text-sm font-medium text-rose-900">This link is closed.</p>
        <p className="mt-1 text-sm text-rose-800">{state.error}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="passcode" className="block text-sm font-medium">
        Enter the six-digit code
      </label>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Whoever sent you this link was given a code to pass on separately. It was not sent
        in the same message on purpose.
      </p>
      <input
        id="passcode"
        name="passcode"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
        placeholder="000000"
        className="nf-field mt-2 text-center text-2xl tracking-[0.4em] tabular-nums"
      />

      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="nf-btn nf-btn-primary mt-4 w-full justify-center disabled:opacity-60"
      >
        {pending ? "Checking…" : "Unlock the document"}
      </button>
    </form>
  );
}
