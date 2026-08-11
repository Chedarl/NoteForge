import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import IntakeForm from "@/components/therapist/IntakeForm";
import { EmptyState } from "@/components/shared/ui";
import { identityOf } from "@/lib/clients/identity";
import { templatesFor } from "@/lib/intake/disciplines";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const user = await requireRole(["THERAPIST", "OWNER"]);
  const { client: preselected } = await searchParams;

  // Non-active clients are fetched too, and shown, disabled, with their status.
  // Hiding them would leave a therapist hunting for a client who is right there
  // and concluding the system is broken; showing them refused, with a reason, is
  // how the status change gets noticed.
  const clients = await prisma.client.findMany({
    where: {
      practiceId: user.practiceId,
      ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
    },
    orderBy: [{ status: "asc" }, { clientCode: "asc" }],
    select: {
      id: true,
      clientCode: true,
      initials: true,
      status: true,
      statusReason: true,
      statusChangedAt: true,
      givenNameEnc: true,
      familyInitial: true,
      birthYear: true,
    },
  });

  if (!user.discipline) {
    return (
      <EmptyState
        title="Set your discipline first"
        body="Which template you get, and what kind of note is written from your submissions, both depend on it. It takes one click on the Your discipline page."
      />
    );
  }

  if (clients.length === 0) {
    return (
      <div className="max-w-2xl">
        <EmptyState
          title="No clients yet"
          body="Add a client before filing notes against them."
        />
        <Link
          href="/t/clients/new"
          className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Add a client
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Write a note</h1>
      <p className="mt-1 text-sm text-slate-600">
        Typed notes reach the production queue immediately and are turned around faster than
        photographed paper — there is nothing to transcribe and nothing to verify.
      </p>
      <IntakeForm
        clients={clients.map((client) => ({
          id: client.id,
          clientCode: client.clientCode,
          label: identityOf(client).displayName ?? client.initials,
          status: client.status,
          statusReason: client.statusReason,
          statusChangedAt: client.statusChangedAt,
        }))}
        preselectedClientId={preselected ?? ""}
        allowedTemplates={templatesFor(user.discipline)}
        discipline={user.discipline}
      />
    </div>
  );
}
