import type { ClientStatus } from "@prisma/client";

/**
 * How a client status is named and coloured.
 *
 * Separated from `guard.ts` for one concrete reason: the guard is `server-only`
 * — it reaches the database and decides whether a write may happen — while the
 * status badge is rendered inside client components on the therapist's phone.
 * Putting the labels here lets both sides share one source of truth without
 * dragging the enforcement code into the browser bundle.
 *
 * There is nothing sensitive in this file, and that is the test for whether
 * something belongs in it.
 */

export const STATUS_LABEL: Record<ClientStatus, string> = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  DISCHARGED: "Discharged",
  TRANSFERRED: "Transferred",
  DECEASED: "Deceased",
  OTHER: "Other",
};

/** Deceased is not red-for-alarm. It is sombre, because it is not an error. */
export const STATUS_CLASS: Record<ClientStatus, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  ON_HOLD: "bg-amber-50 text-amber-800 ring-amber-600/20",
  DISCHARGED: "bg-slate-100 text-slate-700 ring-slate-500/20",
  TRANSFERRED: "bg-sky-50 text-sky-800 ring-sky-600/20",
  DECEASED: "bg-neutral-800 text-neutral-100 ring-neutral-700",
  // No colour of its own: "other" means the reason is the information, and a
  // distinct hue would imply a meaning this status does not carry.
  OTHER: "bg-slate-100 text-slate-700 ring-slate-500/20",
};

export const STATUS_OPTIONS: ClientStatus[] = [
  "ACTIVE",
  "ON_HOLD",
  "DISCHARGED",
  "TRANSFERRED",
  "DECEASED",
  "OTHER",
];
