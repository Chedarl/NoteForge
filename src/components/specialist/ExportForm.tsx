"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { StatusBadge } from "@/components/shared/ui";
import type { ClientStatus } from "@prisma/client";

interface ClientOption {
  id: string;
  clientCode: string;
  displayName: string | null;
  initials: string;
  status: ClientStatus;
  submissionCount: number;
}

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/**
 * Choosing what to download.
 *
 * The two switches at the bottom are the ones worth pausing over, and the copy
 * says why rather than just labelling them. Including names turns the bundle
 * from pseudonymised material into identifiable material, and that changes
 * where it may legitimately be uploaded — a decision that belongs to the person
 * clicking the button, made with the consequence in front of them.
 *
 * It is a plain link rather than a fetch: the browser's own download handling
 * is better than anything reimplemented here, and it keeps a multi-megabyte ZIP
 * out of JavaScript memory on the way through.
 */
export default function ExportForm({
  clients,
  namesAvailable,
}: {
  clients: ClientOption[];
  namesAvailable: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [includeNames, setIncludeNames] = useState(false);
  const [includeBlocked, setIncludeBlocked] = useState(false);
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(
      (c) =>
        c.clientCode.toLowerCase().includes(needle) ||
        c.initials.toLowerCase().includes(needle) ||
        (c.displayName ?? "").toLowerCase().includes(needle)
    );
  }, [clients, filter]);

  const href = useMemo(() => {
    const params = new URLSearchParams({ from, to });
    if (selected.length > 0) params.set("clients", selected.join(","));
    if (includeNames) params.set("names", "1");
    if (includeBlocked) params.set("blocked", "1");
    return `/api/export?${params.toString()}`;
  }, [from, to, selected, includeNames, includeBlocked]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  return (
    <div className="space-y-6">
      {/* ── Dates ──────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Session dates</h2>
        <p className="mt-1 text-xs text-slate-500">
          Filtered by when the session happened, not when it was submitted.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            To
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {[
            { label: "Last 7 days", days: 7 },
            { label: "Last 30 days", days: 30 },
            { label: "Last 90 days", days: 90 },
            { label: "Last year", days: 365 },
          ].map((preset) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => {
                setFrom(isoDaysAgo(preset.days));
                setTo(new Date().toISOString().slice(0, 10));
              }}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      {/* ── Clients ────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Clients</h2>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setSelected([])}
              className="rounded border border-slate-300 px-2 py-1"
            >
              Everyone (batch)
            </button>
            <button
              type="button"
              onClick={() => setSelected(visible.map((c) => c.id))}
              className="rounded border border-slate-300 px-2 py-1"
            >
              Select all shown
            </button>
          </div>
        </div>

        <p className="mt-1 text-xs text-slate-500">
          {selected.length === 0
            ? "Nothing selected — every client with a session in the range will be included."
            : `${selected.length} client${selected.length === 1 ? "" : "s"} selected.`}
        </p>

        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by code, initials or name"
          className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />

        <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {visible.map((client) => (
            <li key={client.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selected.includes(client.id)}
                  onChange={() => toggle(client.id)}
                  className="size-4"
                />
                <span className="font-medium">{client.clientCode}</span>
                <span className="text-xs text-slate-500">
                  {client.displayName ?? client.initials}
                </span>
                <StatusBadge status={client.status} />
                <span className="ml-auto text-xs tabular-nums text-slate-400">
                  {client.submissionCount} submission{client.submissionCount === 1 ? "" : "s"}
                </span>
              </label>
            </li>
          ))}
          {visible.length === 0 ? (
            <li className="px-2 py-3 text-sm text-slate-500">Nothing matches that filter.</li>
          ) : null}
        </ul>
      </section>

      {/* ── The two decisions ──────────────────────────────────────────── */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">What goes in the file</h2>

        <label className="mt-3 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={includeNames && namesAvailable}
            disabled={!namesAvailable}
            onChange={(e) => setIncludeNames(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span className="text-sm">
            <span className="font-medium">Include client names</span>
            <span className="block text-xs text-slate-500">
              {namesAvailable
                ? "First name and surname initial. This makes the bundle identifiable material — do not upload it anywhere you would not put a clinical record. Client codes are always included and are enough to match against your own system."
                : "Unavailable: no encryption key is configured on this deployment, so no names are stored."}
            </span>
          </span>
        </label>

        <label className="mt-3 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={includeBlocked}
            onChange={(e) => setIncludeBlocked(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span className="text-sm">
            <span className="font-medium">Include submissions refused on client status</span>
            <span className="block text-xs text-slate-500">
              Sessions filed against a discharged, transferred or deceased client. Marked
              <code className="mx-1">BLOCKED</code>
              and never queued. Include these only if you are reconciling them — no note
              should be written from one without checking the status first.
            </span>
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={href}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          <Download size={14} />
          Download {selected.length === 0 ? "batch" : `${selected.length} client${selected.length === 1 ? "" : "s"}`}
        </a>
        <span className="text-xs text-slate-500">
          Recorded in the audit trail, including whether names were included.
        </span>
      </div>
    </div>
  );
}
