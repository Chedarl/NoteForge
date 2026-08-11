import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { fieldCryptoConfigured } from "@/lib/crypto/field";
import ClientForm from "@/components/therapist/ClientForm";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const user = await requireRole(["OWNER", "SPECIALIST"]);

  const therapists = await prisma.user.findMany({
    where: { practiceId: user.practiceId, role: "THERAPIST", status: "ACTIVE" },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Add a client</h1>
      <p className="mt-1 text-sm text-slate-600">
        Registering a client here lets their clinician start filing notes against them.
      </p>
      <ClientForm therapists={therapists} canAssign namesAvailable={fieldCryptoConfigured()} />
    </div>
  );
}
