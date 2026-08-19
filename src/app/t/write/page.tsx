import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PICKER_TAKE, toPickList } from "@/lib/clients/pickList";
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

  const clients = await prisma.client.findMany({
    where: {
      practiceId: user.practiceId,
      ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
    },
    orderBy: [{ status: "asc" }, { lastEncounterAt: "desc" }],
    // Capped like every other picker; see `pickList.ts`. This one is a
    // datalist of names to type against rather than a select, so the cap is
    // even less visible — which is exactly why it needs a ceiling.
    take: PICKER_TAKE,
  });
  const { clients: pickable } = toPickList(clients);

  /*
   * `noteWriterWhatsApp` arrived in a later migration, so a database that was
   * created and then never migrated answers every other query happily and
   * throws only here. That produced a blank "a server-side exception has
   * occurred" on the one screen the product exists for, while the rest of the
   * app looked fine — which reads as "the app is broken" rather than
   * "migrations were not run".
   *
   * Caught, so the screen still renders and says what to do. Not swallowed:
   * `migrationsPending` puts a banner at the top rather than letting somebody
   * type a round into a database that cannot store it.
   */
  let practice: { noteWriterWhatsApp: string | null } | null = null;
  let migrationsPending = false;
  try {
    practice = await prisma.practice.findUnique({
      where: { id: user.practiceId },
      select: { noteWriterWhatsApp: true },
    });
  } catch {
    migrationsPending = true;
  }

  // Only the name goes into the picker. `labelOf` prefixes the code, which is
  // right everywhere else but would put "RVN-0142 · Smith J" into a box the
  // clinician is meant to type a name into.
  const options: QuickClient[] = pickable.map((client) => {
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

      {migrationsPending && (
        <div className="mt-6 rounded-[var(--nf-radius)] border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm text-amber-900">
          <p className="font-semibold">This deployment is not fully set up.</p>
          <p className="mt-1">
            The database is reachable but is missing the latest tables, so updates cannot be
            saved yet. Run <code className="font-mono">npx prisma migrate deploy</code>{" "}
            against it. <a href="/api/health" className="underline">/api/health</a> shows
            exactly what is configured.
          </p>
        </div>
      )}

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
        canSaveDefault={user.role === "OWNER"}
      />
    </div>
  );
}
