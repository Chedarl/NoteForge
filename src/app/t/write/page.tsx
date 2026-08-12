import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { identityOf } from "@/lib/clients/identity";
import { whatsappConfigured } from "@/lib/whatsapp/send";
import { QuickUpdate, type QuickClient } from "@/components/therapist/QuickUpdate";

export const dynamic = "force-dynamic";

/**
 * The fast path: write what was discussed, get the PDF, send it.
 *
 * Separate from `/t/new`, which is the structured template form, because the
 * two serve different moments. This one is for the clinician between visits with
 * a phone in one hand; the other is for someone sitting down to record a full
 * structured encounter. Both land in the same table through the same door.
 */
export default async function WritePage() {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  const [clients, practice] = await Promise.all([
    prisma.client.findMany({
      where: {
        practiceId: user.practiceId,
        ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
      },
      orderBy: [{ status: "asc" }, { lastEncounterAt: "desc" }],
    }),
    prisma.practice.findUnique({
      where: { id: user.practiceId },
      select: { noteWriterWhatsApp: true },
    }),
  ]);

  // Only the name goes into the picker. `labelOf` prefixes the code, which is
  // right everywhere else but would put "RVN-0142 · Smith J" into a box the
  // clinician is meant to type a name into.
  const options: QuickClient[] = clients.map((client) => {
    const identity = identityOf(client);
    return {
      id: client.id,
      label: identity.displayName ?? client.initials,
      code: client.clientCode,
    };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
        Write an update
      </h1>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-slate-600">
        Say what happened in your own words. We turn it into a clean PDF and send it to
        whoever writes the notes.
      </p>

      {/*
        No "add a client first" gate. There used to be one, and it was the exact
        step the paper process does not have: a clinician with a page of updates
        to file should not be sent to a different screen to create records
        before they can write. An unknown name creates the client on submit.
      */}
      <QuickUpdate
        clients={options}
        noteWriterNumber={practice?.noteWriterWhatsApp ?? null}
        whatsappReady={whatsappConfigured()}
      />
    </div>
  );
}
