"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type SignupState } from "@/lib/auth/actions";
import { DISCIPLINE_LABEL, DISCIPLINE_OPTIONS } from "@/lib/intake/disciplines";

export default function SignupForm() {
  const [state, formAction, pending] = useActionState<SignupState, FormData>(signup, {});

  if (state.success) {
    return (
      <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="font-semibold text-emerald-900">Workspace reserved</h2>
        <p className="mt-1 text-sm text-emerald-800">{state.success}</p>
        <Link href="/login" className="mt-4 inline-block text-sm font-medium underline">
          Return to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <label className="block text-sm font-medium">
        Your name
        <input
          name="fullName"
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#087f8c] focus:ring-2 focus:ring-teal-100"
        />
      </label>

      <label className="block text-sm font-medium">
        Practice or business name
        <input
          name="practiceName"
          autoComplete="organization"
          required
          minLength={2}
          maxLength={120}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#087f8c] focus:ring-2 focus:ring-teal-100"
        />
      </label>

      <label className="block text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#087f8c] focus:ring-2 focus:ring-teal-100"
        />
      </label>

      <label className="block text-sm font-medium">
        Discipline
        <select
          name="discipline"
          defaultValue="OTHER"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#087f8c] focus:ring-2 focus:ring-teal-100"
        >
          {DISCIPLINE_OPTIONS.map((discipline) => (
            <option key={discipline} value={discipline}>
              {DISCIPLINE_LABEL[discipline]}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm shadow-sm outline-none focus:border-[#087f8c] focus:ring-2 focus:ring-teal-100"
        />
        <span className="mt-1 block text-xs font-normal text-slate-500">
          At least 10 characters. You are signed in straight away — no confirmation email.
        </span>
      </label>

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
        {pending ? "Creating portal…" : "Create my portal"}
      </button>

      <p className="text-center text-sm text-slate-600">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-sky-700 underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
