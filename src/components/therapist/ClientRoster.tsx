import Link from "next/link";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { whatsappConfigured } from "@/lib/whatsapp/send";
import SendClientList from "@/components/therapist/SendClientList";
import StatusChanger from "@/components/therapist/StatusChanger";
import { Card, EmptyState, Pill, SectionTitle, StatusBadge } from "@/components/shared/ui";
import { fmtDate, ageLabel } from "@/lib/utils";
import { identityOf } from "@/lib/clients/identity";

/**
 * The caseload, with status first on every row.
 *
 * This used to *be* the clinician's home screen. It moved to `/t/clients` when
 * the per-discipline dashboards landed, and became a component rather than a
 * page because two callers need it: `/t/clients` for everybody, and `/t` itself
 * for the generic portal — somebody who has not told us their discipline keeps
 * exactly the screen they have always had, because guessing at a portal for
 * work we know nothing about would be worse than the familiar one.
 *
 * Status leads every row rather than sitting on a sub-page, and that is the
 * original reason this screen exists: the failure this product prevents starts
 * with somebody not knowing a status changed. If it takes a click to see, it
 * will not be seen.
 */
export default async function ClientRoster({ user }: { user: User }) {
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

  /*
   * The note-writer number lives on a column added in a later migration, so a
   * database that was never migrated throws here while every other query is
   * fine. Caught so the caseload still renders and can still be downloaded.
   */
  let noteWriterNumber: string | null = null;
  try {
    const practice = await prisma.practice.findUnique({
      where: { id: user.practiceId },
      select: { noteWriterWhatsApp: true },
    });
    noteWriterNumber = practice?.noteWriterWhatsApp ?? null;
  } catch {
    // Left null — the list can still be built and downloaded.
  }

  return (
    <div className="space-y-8">
      {clients.length > 0 && (
        <SendClientList
          noteWriterNumber={noteWriterNumber}
          whatsappReady={whatsappConfigured()}
          clientCount={clients.length}
          activeCount={active.length}
        />
      )}

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
