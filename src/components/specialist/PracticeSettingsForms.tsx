"use client";

import { useActionState, useState } from "react";
import {
  invitePracticeUser,
  setPracticeUserStatus,
  updatePracticeSettings,
  type InviteState,
  type SettingsState,
} from "@/lib/admin/actions";
import { DISCIPLINE_LABEL, DISCIPLINE_OPTIONS } from "@/lib/intake/disciplines";
import type { UserRole, UserStatus } from "@prisma/client";

export function WhatsAppSettingsForm({ defaultPhone }: { defaultPhone: string }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updatePracticeSettings,
    {}
  );

  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm font-medium">
        Note writer's WhatsApp number
        <input
          name="noteWriterWhatsApp"
          type="tel"
          autoComplete="tel"
          defaultValue={defaultPhone}
          placeholder="+1 312 555 0123"
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      <p className="text-xs leading-relaxed text-slate-500">
        Include the country code. This pre-fills the recipient after a clinician creates a
        PDF; it is never shown to clients.
      </p>
      {state.error ? <p className="text-sm text-rose-700">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-700">{state.success}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save WhatsApp number"}
      </button>
    </form>
  );
}

export function InviteUserForm() {
  const [role, setRole] = useState<UserRole>("THERAPIST");
  const [state, action, pending] = useActionState<InviteState, FormData>(invitePracticeUser, {});

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">
        Full name
        <input
          name="fullName"
          required
          minLength={2}
          maxLength={100}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      <label className="block text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          autoComplete="off"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </label>
      <label className="block text-sm font-medium">
        Portal role
        <select
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
        >
          <option value="THERAPIST">Clinician — submits client information</option>
          <option value="SPECIALIST">Note specialist — verifies and writes notes</option>
        </select>
      </label>
      <label className="block text-sm font-medium">
        Discipline
        <select
          name="discipline"
          defaultValue="OTHER"
          disabled={role !== "THERAPIST"}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-100"
        >
          {DISCIPLINE_OPTIONS.map((discipline) => (
            <option key={discipline} value={discipline}>
              {DISCIPLINE_LABEL[discipline]}
            </option>
          ))}
        </select>
        {role !== "THERAPIST" ? (
          <input type="hidden" name="discipline" value="OTHER" />
        ) : null}
      </label>
      <div className="sm:col-span-2">
        {state.error ? <p className="mb-3 text-sm text-rose-700">{state.error}</p> : null}
        {state.success ? <p className="mb-3 text-sm text-emerald-700">{state.success}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Sending invitation…" : "Invite team member"}
        </button>
      </div>
    </form>
  );
}

export function UserStatusForm({
  userId,
  status,
}: {
  userId: string;
  status: UserStatus;
}) {
  const next: UserStatus = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  return (
    <form action={setPracticeUserStatus}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="status" value={next} />
      <button
        type="submit"
        className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
          next === "ACTIVE"
            ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "bg-rose-50 text-rose-700 hover:bg-rose-100"
        }`}
      >
        {next === "ACTIVE" ? "Reactivate" : "Suspend"}
      </button>
    </form>
  );
}
