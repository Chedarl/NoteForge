import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { labelOf } from "@/lib/clients/identity";
import { whatsappConfigured } from "@/lib/whatsapp/send";
import { QuickUpdate, type QuickClient } from "@/components/therapist/QuickUpdate";
import { EmptyState } from "@/components/shared/ui";
import Link from "next/link";

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

  const options: QuickClient[] = clients.map((client) => ({
    id: client.id,
    label: labelOf(client),
    status: client.status,
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Write an update</h1>
      <p className="mt-1 text-sm text-slate-600">
        Say what happened in your own words. It is saved with the date and time, turned into
        a PDF, and sent to whoever writes the notes — the note gets written from that.
      </p>

      {options.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No clients yet"
            body="Add a client before writing an update. They are identified by a practice code, not a name."
          />
          <Link href="/t/clients/new" className="mt-3 inline-block text-sm font-medium underline">
            Add a client
          </Link>
        </div>
      ) : (
        <QuickUpdate
          clients={options}
          noteWriterNumber={practice?.noteWriterWhatsApp ?? null}
          whatsappReady={whatsappConfigured()}
        />
      )}
    </div>
  );
}
