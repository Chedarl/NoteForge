import Link from "next/link";
import { cn } from "@/lib/utils";
import { STATUS_CLASS, STATUS_LABEL } from "@/lib/clients/labels";
import type { ClientStatus } from "@prisma/client";
import BrandLogo from "@/components/shared/BrandLogo";

/**
 * The small shared kit. Deliberately tiny — six primitives and no component
 * library, because every dependency in a project like this is one more vendor
 * to reason about and one more thing between a clinician and a working form.
 */

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-slate-200/90 bg-white p-4 shadow-[0_8px_28px_-20px_rgba(5,30,65,0.5)]", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold tracking-wide text-slate-900 uppercase">{children}</h2>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * A client's status, shown the same way everywhere.
 *
 * It appears on the picker, the queue row, the note editor and the client page
 * — one component so those four can never disagree, which matters because the
 * whole product rests on somebody noticing this badge.
 */
export function StatusBadge({ status }: { status: ClientStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        STATUS_CLASS[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "amber" | "rose" | "emerald" | "sky";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-100 text-amber-800",
    rose: "bg-rose-100 text-rose-800",
    emerald: "bg-emerald-100 text-emerald-800",
    sky: "bg-sky-100 text-sky-800",
  };
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "warn" | "good";
}) {
  return (
    <Card className="flex flex-col">
      <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</span>
      <span
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "warn" && "text-amber-700",
          tone === "good" && "text-emerald-700"
        )}
      >
        {value}
      </span>
      {sub ? <span className="mt-1 text-xs text-slate-500">{sub}</span> : null}
    </Card>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{body}</p>
    </div>
  );
}

export function Nav({
  items,
  current,
  right,
}: {
  items: { href: string; label: string }[];
  current: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="border-b border-white/10 bg-[#020713] text-white shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
        <BrandLogo className="w-32 shrink-0 rounded-md sm:w-40" />
        <nav className="flex flex-1 flex-wrap gap-x-4 gap-y-1 text-sm">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded px-2 py-1",
                current === item.href
                  ? "bg-white text-slate-950"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="text-slate-300 [&_button]:text-slate-300 [&_span]:text-slate-300">
          {right}
        </div>
      </div>
    </header>
  );
}