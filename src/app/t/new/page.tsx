import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import IntakeForm from "@/components/therapist/IntakeForm";
import { EmptyState } from "@/components/shared/ui";
import { identityOf } from "@/lib/clients/identity";
import { displayPolicyFor } from "@/lib/clients/displayPolicy";
import { templatesFor } from "@/lib/intake/disciplines";
import { practiceNeeds } from "@/lib/intake/practiceNeeds";
import { previousSubmissionFor } from "@/lib/intake/previous";
import { PICKER_TAKE, toPickList } from "@/lib/clients/pickList";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; template?: string }>;
}) {
  const user = await requireRole(["THERAPIST", "OWNER"]);
  const naming = await displayPolicyFor(user.practiceId);
  const needs = await practiceNeeds(user.practiceId);
  const { client: preselected, template: requestedTemplate } = await searchParams;

  // Non-active clients are fetched too, and shown, disabled, with their status.
  // Hiding them would leave a therapist hunting for a client who is right there
  // and concluding the system is broken; showing them refused, with a reason, is
  // how the status change gets noticed.
  const [clients, practice] = await Promise.all([
    prisma.client.findMany({
      where: {
        practiceId: user.practiceId,
        ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
      },
      // Most recently seen first, so a capped list drops the part of a long
      // caseload nobody is about to write about. See `pickList.ts`.
      orderBy: [{ status: "asc" }, { lastEncounterAt: "desc" }, { clientCode: "asc" }],
      take: PICKER_TAKE,
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
    }),
    prisma.practice.findUnique({
      where: { id: user.practiceId },
      select: { noteWriterWhatsApp: true },
    }),
  ]);

  const { clients: pickable, capped } = toPickList(clients);

  if (!user.discipline) {
    return (
      <EmptyState
        title="Set your discipline first"
        body="Which template you get, and what kind of note is written from your submissions, both depend on it. It takes one click on the Your discipline page."
      />
    );
  }

  if (pickable.length === 0) {
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

  /*
   * A template named in the URL is honoured only if this clinician is offered
   * it. The dashboard's primary action puts it there, and a hand-typed or stale
   * value must not leave the select showing an option it does not contain.
   */
  const offered = templatesFor(user.discipline);
  const offeredTemplate = offered.find((kind) => kind === requestedTemplate);

  /*
   * Fetched on the server for whichever client the page opens on, so the last
   * encounter is on screen before the first render rather than arriving a
   * moment later. Changing the dropdown fetches the next one through a server
   * action; this is only the head start.
   */
  const openingClientId = preselected || pickable[0].id;
  const previous = await previousSubmissionFor({
    practiceId: user.practiceId,
    clientId: openingClientId,
    restrictToTherapistId: user.role === "THERAPIST" ? user.id : undefined,
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Write a note</h1>
      <p className="mt-1 text-sm text-slate-600">
        Typed notes reach the production queue immediately and are turned around faster than
        photographed paper — there is nothing to transcribe and nothing to verify.
      </p>
      <IntakeForm
        capped={capped}
        clients={pickable.map((client) => ({
          id: client.id,
          clientCode: client.clientCode,
          label: identityOf(naming, client).displayName ?? client.initials,
          status: client.status,
          statusReason: client.statusReason,
          statusChangedAt: client.statusChangedAt,
        }))}
        preselectedClientId={preselected ?? ""}
        previous={previous}
        preselectedTemplate={offeredTemplate}
        allowedTemplates={offered}
        needs={needs}
        discipline={user.discipline}
        defaultWhatsApp={practice?.noteWriterWhatsApp ?? ""}
      />
    </div>
  );
}