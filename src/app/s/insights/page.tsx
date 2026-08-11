import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { clinicalSignal, operationalMetrics, therapistVolume } from "@/lib/insights/metrics";
import { Card, EmptyState, SectionTitle, Stat } from "@/components/shared/ui";
import { fmtDate, pct } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last year", days: 365 },
];

/**
 * The page that turns a typing service into an operations partner.
 *
 * Two halves and a line between them. The operational half measures *us* — how
 * fast, how complete, how many duplicates caught, how often a status guardrail
 * fired. The clinical half reports only what a specialist explicitly tagged.
 *
 * The status-block rate is the number worth defending in a sales conversation:
 * every one of those is a note that would otherwise have been typed up against
 * somebody discharged, transferred or dead.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireRole(["OWNER", "SPECIALIST"]);
  const { range: rangeKey } = await searchParams;
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];

  const since = new Date();
  since.setDate(since.getDate() - range.days);

  const [metrics, signal, volume, practice] = await Promise.all([
    operationalMetrics(user.practiceId, since),
    clinicalSignal(user.practiceId, since),
    therapistVolume(user.practiceId, since),
    prisma.practice.findUnique({
      where: { id: user.practiceId },
      select: { slaHours: true, staleDays: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Insights</h1>
          <p className="mt-1 text-sm text-slate-600">
            {practice?.name} · {range.label.toLowerCase()}
          </p>
        </div>
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/s/insights?range=${r.key}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                r.key === range.key
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 text-slate-700"
              }`}
            >
              {r.label}
            </Link>
          ))}
          <a
            href={`/api/insights/export?range=${range.key}`}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* ── Operations ─────────────────────────────────────────────────── */}
      <section>
        <SectionTitle hint="How the service performed. Computed live from the records themselves.">
          Operations
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Received" value={metrics.received} sub="submissions in period" />
          <Stat label="Delivered" value={metrics.delivered} sub="notes signed and handed back" />
          <Stat
            label="Turnaround p50"
            value={metrics.turnaroundP50 === null ? "—" : `${metrics.turnaroundP50} h`}
            sub={
              metrics.turnaroundP90 === null
                ? "nothing delivered yet"
                : `p90 ${metrics.turnaroundP90} h · target ${practice?.slaHours ?? 48} h`
            }
          />
          <Stat
            label="Within target"
            value={metrics.onTimeRate === null ? "—" : `${Math.round(metrics.onTimeRate * 100)}%`}
            tone={metrics.onTimeRate !== null && metrics.onTimeRate < 0.9 ? "warn" : "good"}
          />
        </div>
      </section>

      {/* ── Data hygiene ───────────────────────────────────────────────── */}
      <section>
        <SectionTitle hint="What the intake layer caught before anyone wasted time on it.">
          Data hygiene
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Blocked on status"
            value={metrics.blocked}
            sub={`${pct(metrics.blocked, metrics.received)} of submissions — notes prevented against inactive or deceased clients`}
            tone={metrics.blocked > 0 ? "warn" : "default"}
          />
          <Stat
            label="Duplicates flagged"
            value={metrics.duplicatesFlagged}
            sub="caught before being typed twice"
          />
          <Stat
            label="Contradictions"
            value={metrics.conflictsFlagged}
            sub="conflicting accounts of the same period"
            tone={metrics.conflictsFlagged > 0 ? "warn" : "default"}
          />
          <Stat
            label="Open decisions"
            value={metrics.openFlags}
            sub="flags waiting on a person"
          />
        </div>
      </section>

      {/* ── Input quality ──────────────────────────────────────────────── */}
      <section>
        <SectionTitle hint="What arrives, and how usable it is. The lever on turnaround.">
          Input quality
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Intake completeness"
            value={
              metrics.intakeCompleteness === null
                ? "—"
                : `${Math.round(metrics.intakeCompleteness * 100)}%`
            }
            sub="required sections filled on typed intake"
          />
          <Stat
            label="OCR accepted as-is"
            value={
              metrics.firstPassVerifyRate === null
                ? "—"
                : `${Math.round(metrics.firstPassVerifyRate * 100)}%`
            }
            sub="transcripts a human did not have to edit"
          />
          <Stat
            label="Handover delay"
            value={
              metrics.medianHandoverDays === null
                ? "—"
                : `${metrics.medianHandoverDays.toFixed(1)} d`
            }
            sub="median days from session to submission"
            tone={
              metrics.medianHandoverDays !== null && metrics.medianHandoverDays > 7
                ? "warn"
                : "default"
            }
          />
        </div>
      </section>

      {/* ── Clinical signal ────────────────────────────────────────────── */}
      <section>
        <SectionTitle hint="Only what a specialist explicitly marked while writing. Never inferred from note text.">
          Clinical signal
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Goals progressing" value={signal.goalProgress} tone="good" />
          <Stat label="Goals stalled" value={signal.goalStalled} tone="warn" />
          <Stat label="Risk noted" value={signal.risk} tone={signal.risk > 0 ? "warn" : "default"} />
          <Stat label="Engagement dropping" value={signal.engagementDrop} />
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-medium">
            Active clients with no session for {practice?.staleDays ?? 60}+ days
          </h3>
          {signal.quietClients.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">None. Every active client is current.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {signal.quietClients.map((client) => (
                <Card key={client.id} className="flex items-center gap-3 py-2">
                  <Link href={`/s/clients/${client.id}`} className="font-medium underline">
                    {client.clientCode}
                  </Link>
                  <span className="text-xs text-slate-500">
                    Last session{" "}
                    {client.lastEncounterAt ? fmtDate(client.lastEncounterAt) : "never recorded"}
                  </span>
                  <span className="ml-auto text-xs text-amber-700">
                    Still marked active — worth confirming
                  </span>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── By therapist ───────────────────────────────────────────────── */}
      <section>
        <SectionTitle hint="Volume and status accuracy per clinician.">By therapist</SectionTitle>
        {volume.length === 0 ? (
          <EmptyState title="No therapists yet" body="Volume appears once submissions arrive." />
        ) : (
          <div className="space-y-1.5">
            {volume.map((row) => (
              <Card key={row.id} className="flex items-center gap-4 py-2">
                <span className="min-w-48 text-sm font-medium">{row.name}</span>
                <span className="text-sm tabular-nums">{row.total} submissions</span>
                {row.blocked > 0 ? (
                  <span className="text-sm text-amber-700 tabular-nums">
                    {row.blocked} blocked on status
                  </span>
                ) : (
                  <span className="text-sm text-emerald-700">no status errors</span>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
