"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type LoginState } from "@/lib/auth/actions";

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <input type="hidden" name="next" value={next} />

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-[#087f8c] focus:ring-2 focus:ring-teal-100"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-[#087f8c] focus:ring-2 focus:ring-teal-100"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[#087f8c] px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#066b76] disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-slate-600">
        New practice?{" "}
        <Link href="/signup" className="font-medium text-sky-700 underline">
          Create your portal
        </Link>
      </p>
    </form>
  );
}