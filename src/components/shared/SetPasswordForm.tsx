"use client";

import { useActionState } from "react";
import { setPassword, type PasswordState } from "@/lib/auth/actions";

export default function SetPasswordForm() {
  const [state, formAction, pending] = useActionState<PasswordState, FormData>(setPassword, {});

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <label className="block text-sm font-medium">
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm font-medium">
        Confirm password
        <input
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Set password and open portal"}
      </button>
    </form>
  );
}
