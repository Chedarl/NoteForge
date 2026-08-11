import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { clinicalSignal, operationalMetrics } from "@/lib/insights/metrics";
import { Card, SectionTitle, Stat } from "@/components/shared/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The therapist's view of their own practice.
 *
 * Scoped to their clients and **summary only**. There is no route from this
 * page to another clinician's caseload and no note text anywhere on it — what a
 * therapist gets is counts, dates and trends, which is what supervision and
 * treatment planning actually need and is the separation the regulation
 * expects between progress notes and psychotherapy notes.
 */
export default async function TherapistInsights() {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  const since = new Date();
  since.setDate(since.getDate() - 90);

  const [metrics, signal, mine, practice] = await Promise.all([
    operationalMetrics(user.practiceId, since),
    clinicalSignal(user.practiceId, since, user.role === "THERAPIST" ? user.id : undefined),
    prisma.submission.groupBy({
      by: ["state"],
      where: { practiceId: user.practiceId, submittedById: user.id, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.practice.findUnique({
      where: { id: user.practiceId },
      select: { staleDays: true, slaHours: true },
    }),
  ]);

  const mineTotal = mine.reduce((sum, row) => sum + row._count._all, 0);
  const mineBlocked = mine.find((row) => row.state === "BLOCKED")?._count._all ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Your last 90 days</h1>
        <p className="mt-1 text-sm text-slate-600">
          Summaries only. No note text appears here, and nothing on this page is another
          clinician&apos;s caseload.
        </p>
      </div>

      <section>
        <SectionTitle>Your submissions</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Submitted" value={mineTotal} sub="notes handed over" />
          <Stat
            label="Refused on status"
            value={mineBlocked}
            sub={mineBlocked ? "a client status needed correcting" : "no status errors"}
            tone={mineBlocked > 0 ? "warn" : "good"}
          />
          <Stat
            label="Practice turnaround"
            value={metrics.turnaroundP50 === null ? "—" : `${metrics.turnaroundP50} h`}
            sub={`median · target ${practice?.slaHours ?? 48} h`}
          />
        </div>
      </section>

      <section>
        <SectionTitle hint="Marked by the specialist writing up each note.">
          Signals across your clients
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Goals progressing" value={signal.goalProgress} tone="good" />
          <Stat label="Goals stalled" value={signal.goalStalled} tone="warn" />
          <Stat label="Risk noted" value={signal.risk} tone={signal.risk > 0 ? "warn" : "default"} />
          <Stat label="Engagement dropping" value={signal.engagementDrop} />
        </div>
      </section>

      <section>
        <SectionTitle
          hint={`Active clients you have not seen for ${practice?.staleDays ?? 60}+ days. Worth confirming they are still in treatment.`}
        >
          Quiet clients
        </SectionTitle>
        {signal.quietClients.length === 0 ? (
          <p className="text-sm text-slate-500">None — every active client on your list is current.</p>
        ) : (
          <div className="space-y-1.5">
            {signal.quietClients.map((client) => (
              <Card key={client.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium">{client.clientCode}</span>
                <span className="text-xs text-slate-500">
                  Last session{" "}
                  {client.lastEncounterAt ? fmtDate(client.lastEncounterAt) : "never recorded"}
                </span>
                <Link href="/t" className="ml-auto text-sm text-sky-700 underline">
                  Update their status
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
