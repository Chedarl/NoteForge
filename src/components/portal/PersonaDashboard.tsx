import Link from "next/link";
import {
  Camera,
  Clock,
  Inbox,
  Link2,
  Mic,
  NotebookPen,
  PenLine,
  Stethoscope,
} from "lucide-react";
import type { ClientStatus } from "@prisma/client";
import type { PortalIcon, PortalPersona } from "@/lib/portal/personas";
import type { ClientFacts } from "@/lib/portal/clientFacts";
import { StatusBadge } from "@/components/shared/ui";
import { ageLabel } from "@/lib/utils";

/**
 * The one dashboard, rendered three ways.
 *
 * Everything that differs between a recovery coach's screen and a nurse
 * practitioner's arrives as `persona` — the greeting, the large card, what the
 * small cards are, how many facts sit under a client's name. There is no
 * branching on discipline in this file, and that is the point: adding a portal
 * or moving a discipline between portals is an edit to `personas.ts` and never
 * touches this component.
 *
 * A server component. Nothing here needs state — it is links and text — and
 * making it a client component would ship the whole persona table to the
 * browser for no benefit.
 */

const ICONS: Record<PortalIcon, typeof Mic> = {
  mic: Mic,
  camera: Camera,
  pen: PenLine,
  link: Link2,
  stethoscope: Stethoscope,
  inbox: Inbox,
  notebook: NotebookPen,
};

export interface DashboardClient {
  id: string;
  clientCode: string;
  displayName: string | null;
  status: ClientStatus;
  lastEncounterAt: Date | null;
  facts: ClientFacts;
}

/** A small fact under a client's name. Absent facts never reach this. */
function Chip({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "amber" | "teal" | "rose";
}) {
  const tones = {
    plain: "bg-slate-100 text-slate-700 border-slate-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    teal: "bg-[color:var(--nf-accent-wash)] text-[color:var(--nf-accent)] border-[#b7e0e4]",
    // Reserved for recorded risk, and used nowhere else on this screen.
    rose: "bg-rose-50 text-rose-800 border-rose-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[0.6875rem] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export default function PersonaDashboard({
  persona,
  userName,
  disciplineLabel,
  pendingReviews,
  clients,
}: {
  persona: PortalPersona;
  userName: string;
  disciplineLabel: string;
  /** Only ever non-zero where the persona's nav carries a review queue. */
  pendingReviews: number;
  clients: DashboardClient[];
}) {
  const PrimaryIcon = ICONS[persona.primaryAction.icon];

  // Roomy portals get one action per row and larger targets; dense ones pair
  // the small cards up. This is the only place `density` is read.
  const secondaryColumns =
    persona.density === "roomy" && persona.secondaryActions.length > 2
      ? "grid-cols-2"
      : persona.secondaryActions.length > 1
        ? "grid-cols-2"
        : "grid-cols-1";

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
          {persona.greeting}
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          {userName} · {disciplineLabel}
        </p>
      </header>

      {/*
       * Semantic colour, not the accent. Amber means "something is waiting on
       * you"; teal means "this is the thing to press". Mixing them would make
       * the one button on the screen compete with a notice.
       */}
      {pendingReviews > 0 ? (
        <Link
          href="/t/review"
          className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
        >
          <Clock size={16} className="shrink-0" />
          <span>
            <strong className="font-bold">
              {pendingReviews} field update{pendingReviews === 1 ? "" : "s"}
            </strong>{" "}
            waiting for you to read
          </span>
        </Link>
      ) : null}

      <Link
        href={persona.primaryAction.href}
        className="flex items-center gap-3.5 rounded-2xl bg-[color:var(--nf-accent)] px-4 py-[1.1rem] text-white shadow-[0_1px_2px_rgba(8,127,140,.3)] transition hover:bg-[color:var(--nf-accent-strong)]"
      >
        <span className="grid size-[2.6rem] shrink-0 place-items-center rounded-full bg-white/20">
          <PrimaryIcon size={20} />
        </span>
        <span>
          <strong className="block text-[1.0625rem] font-bold">
            {persona.primaryAction.label}
          </strong>
          {persona.primaryAction.hint ? (
            <small className="mt-0.5 block text-xs opacity-85">
              {persona.primaryAction.hint}
            </small>
          ) : null}
        </span>
      </Link>

      <div className={`grid gap-2 ${secondaryColumns}`}>
        {persona.secondaryActions.map((action) => {
          const Icon = ICONS[action.icon];
          return (
            <Link
              key={action.href + action.label}
              href={action.href}
              className="flex items-center gap-2 rounded-xl border border-[color:var(--nf-border)] bg-white px-3 py-2.5 text-[0.8125rem] font-semibold text-slate-900 transition hover:border-slate-300"
            >
              <Icon size={16} className="shrink-0 text-slate-500" />
              {action.label}
            </Link>
          );
        })}
      </div>

      <section className="mt-1">
        <h2 className="mb-2 text-[0.6875rem] font-bold tracking-[0.1em] text-slate-500 uppercase">
          {persona.clientsHeading}
        </h2>

        {clients.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[color:var(--nf-border)] bg-white px-3 py-4 text-sm text-slate-600">
            Nobody yet. Your first update creates the client — type their name and
            we will find them or open a record.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {clients.map((client) => (
              <Link
                key={client.id}
                href={`/t/new?client=${client.id}`}
                className="rounded-xl border border-[color:var(--nf-border)] bg-white px-3 py-2.5 transition hover:border-slate-300"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-mono text-[0.8125rem] font-semibold text-slate-900">
                    {client.clientCode}
                  </span>
                  {client.displayName ? (
                    <span className="text-[0.8125rem] text-slate-600">
                      {client.displayName}
                    </span>
                  ) : null}
                  {/*
                   * Status is only drawn when it is not ACTIVE. A badge on every
                   * row is a badge nobody reads, and the whole reason status is
                   * on this screen is that a change to it must be noticed.
                   */}
                  {client.status !== "ACTIVE" ? (
                    <StatusBadge status={client.status} />
                  ) : null}
                  {persona.clientFacts.includes("lastContact") && client.lastEncounterAt ? (
                    <span className="ml-auto text-[0.6875rem] text-slate-500 tabular-nums">
                      {ageLabel(client.lastEncounterAt)} ago
                    </span>
                  ) : null}
                </div>

                <ClientFactRow persona={persona} client={client} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The facts under a client's name, in the order the persona asked for them.
 *
 * A fact with no value produces no markup at all — not an empty chip and not a
 * dash. "Risk —" reads as *no risk recorded* when it means *not asked yet*, and
 * on a clinical caseload that is the more dangerous misreading.
 */
function ClientFactRow({
  persona,
  client,
}: {
  persona: PortalPersona;
  client: DashboardClient;
}) {
  const chips: React.ReactNode[] = [];

  for (const key of persona.clientFacts) {
    if (key === "needs" && client.facts.needs?.length) {
      for (const label of client.facts.needs) {
        chips.push(
          <Chip key={`need-${label}`} tone="amber">
            {label}
          </Chip>
        );
      }
    }
    if (key === "medication" && client.facts.medication) {
      chips.push(<Chip key="med">{truncate(client.facts.medication, 40)}</Chip>);
    }
    if (key === "sessionCount" && client.facts.sessionCount) {
      chips.push(
        <Chip key="sessions" tone="teal">
          {client.facts.sessionCount} update
          {client.facts.sessionCount === 1 ? "" : "s"}
        </Chip>
      );
    }
    if (key === "risk" && client.facts.risk) {
      /*
       * Rose, and the only rose on this screen.
       *
       * Colour is reserved for meaning throughout this product, and there is no
       * meaning it is more worth spending on than "the last time anyone asked,
       * this person was not safe". The field is named beside the level because
       * "Active, with plan" reads very differently under suicidal ideation than
       * under substance use.
       */
      chips.push(
        <Chip key="risk" tone="rose">
          {client.facts.risk.field}: {client.facts.risk.label}
        </Chip>
      );
    }
    if (key === "goal" && client.facts.goal) {
      chips.push(<Chip key="goal">{truncate(client.facts.goal, 48)}</Chip>);
    }
  }

  if (chips.length === 0) {
    // Only worth saying for somebody who has never been written up — otherwise
    // the absence of chips is self-explanatory and a line of text is noise.
    return client.lastEncounterAt ? null : (
      <p className="mt-1.5 text-xs text-slate-500">No updates filed yet</p>
    );
  }

  return <div className="mt-1.5 flex flex-wrap gap-1.5">{chips}</div>;
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
