import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { Card, EmptyState, Pill, SectionTitle, StatusBadge } from "@/components/shared/ui";
import { fmtDate, ageLabel } from "@/lib/utils";
import StatusChanger from "@/components/therapist/StatusChanger";
import { identityOf } from "@/lib/clients/identity";

export const dynamic = "force-dynamic";

/**
 * The therapist's home: their own clients, with status front and centre.
 *
 * Status is the first thing on every row rather than a detail on a sub-page,
 * because the failure this product exists to stop begins with somebody not
 * knowing a status changed. If it takes a click to see, it will not be seen.
 */
export default async function TherapistHome() {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  const clients = await prisma.client.findMany({
    where: {
      practiceId: user.practiceId,
      ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
    },
    orderBy: [{ status: "asc" }, { lastEncounterAt: "desc" }],
    include: {
      _count: { select: { submissions: true } },
      statusConfirmations: {
        where: { respondedAt: null },
        select: { id: true },
        take: 1,
      },
    },
  });

  const active = clients.filter((c) => c.status === "ACTIVE");
  const inactive = clients.filter((c) => c.status !== "ACTIVE");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">My clients</h1>
          <p className="mt-1 text-sm text-slate-600">
            {active.length} active, {inactive.length} not accepting new notes.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/t/new"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Write a note
          </Link>
          <Link
            href="/t/upload"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium"
          >
            Photograph paper
          </Link>
          <Link
            href="/t/clients/new"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium"
          >
            Add client
          </Link>
        </div>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          body="Add the clients you see, then file notes against them. A client is a code, a first name and a surname initial — never a full identity."
        />
      ) : null}

      {active.length > 0 ? (
        <section>
          <SectionTitle hint="These accept new notes.">Active</SectionTitle>
          <div className="space-y-2">
            {active.map((client) => (
              <Card key={client.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-40">
                  <div className="font-medium">{client.clientCode}</div>
                  <div className="text-xs text-slate-500">
                    {identityOf(client).displayName ?? client.initials}
                    {client.birthYear ? ` · b. ${client.birthYear}` : ""}
                  </div>
                </div>
                <StatusBadge status={client.status} />
                <div className="text-xs text-slate-500">
                  Last session{" "}
                  {client.lastEncounterAt ? (
                    <>
                      {fmtDate(client.lastEncounterAt)}{" "}
                      <span className="text-slate-400">({ageLabel(client.lastEncounterAt)} ago)</span>
                    </>
                  ) : (
                    "—"
                  )}
                </div>
                {client.statusConfirmations.length > 0 ? (
                  <Pill tone="amber">Confirmation requested</Pill>
                ) : null}
                <div className="ml-auto flex items-center gap-2">
                  <Link
                    href={`/t/new?client=${client.id}`}
                    className="text-sm font-medium text-sky-700 underline"
                  >
                    Write note
                  </Link>
                  <StatusChanger clientId={client.id} current={client.status} />
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {inactive.length > 0 ? (
        <section>
          <SectionTitle hint="New notes are refused for these. Their history stays readable.">
            Not accepting notes
          </SectionTitle>
          <div className="space-y-2">
            {inactive.map((client) => (
              <Card key={client.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-slate-50">
                <div className="min-w-40">
                  <div className="font-medium">{client.clientCode}</div>
                  <div className="text-xs text-slate-500">
                    {identityOf(client).displayName ?? client.initials}
                  </div>
                </div>
                <StatusBadge status={client.status} />
                <div className="max-w-md text-xs text-slate-500">
                  Since {fmtDate(client.statusChangedAt)}
                  {client.statusReason ? ` — ${client.statusReason}` : ""}
                </div>
                <div className="ml-auto">
                  <StatusChanger clientId={client.id} current={client.status} />
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
