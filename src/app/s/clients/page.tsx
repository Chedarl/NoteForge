import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { Card, StatusBadge } from "@/components/shared/ui";
import { fmtDate, ageLabel } from "@/lib/utils";
import { identityOf } from "@/lib/clients/identity";
import { displayPolicyFor } from "@/lib/clients/displayPolicy";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const user = await requireRole(["OWNER", "SPECIALIST"]);
  const naming = await displayPolicyFor(user.practiceId);

  const clients = await prisma.client.findMany({
    where: { practiceId: user.practiceId },
    orderBy: [{ status: "asc" }, { clientCode: "asc" }],
    include: {
      primaryTherapist: { select: { fullName: true } },
      _count: { select: { submissions: true, notes: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Client registry</h1>
          <p className="mt-1 text-sm text-slate-600">
            {clients.length} clients. Identity is deliberately minimal — a practice code, a
            first name encrypted at rest, a surname initial and a birth year. No full names,
            no dates of birth.
          </p>
        </div>
        <Link
          href="/s/clients/new"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
        >
          Add client
        </Link>
      </div>

      <div className="space-y-2">
        {clients.map((client) => (
          <Card key={client.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href={`/s/clients/${client.id}`} className="min-w-36 font-medium underline">
              {client.clientCode}
            </Link>
            <span className="text-xs text-slate-500">
              {identityOf(naming, client).displayName ?? client.initials}
              {client.birthYear ? ` · b. ${client.birthYear}` : ""}
            </span>
            <StatusBadge status={client.status} />
            <span className="text-xs text-slate-500">
              {client.primaryTherapist?.fullName ?? "unassigned"}
            </span>
            <span className="text-xs text-slate-500">
              {client._count.submissions} submissions · {client._count.notes} notes
            </span>
            <span className="ml-auto text-xs text-slate-500">
              {client.lastEncounterAt
                ? `Last session ${fmtDate(client.lastEncounterAt)} (${ageLabel(client.lastEncounterAt)} ago)`
                : "No sessions recorded"}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );
}
