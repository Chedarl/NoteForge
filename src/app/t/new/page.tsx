import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import IntakeForm from "@/components/therapist/IntakeForm";
import { EmptyState } from "@/components/shared/ui";

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
    },
  });

  if (clients.length === 0) {
    return (
      <EmptyState
        title="No clients assigned to you"
        body="The practice owner assigns clients before notes can be filed."
      />
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Write a note</h1>
      <p className="mt-1 text-sm text-slate-600">
        Typed notes reach the production queue immediately and are turned around faster than
        photographed paper — there is nothing to transcribe and nothing to verify.
      </p>
      <IntakeForm clients={clients} preselectedClientId={preselected ?? ""} />
    </div>
  );
}
