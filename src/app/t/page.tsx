import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { personaFor } from "@/lib/portal/personas";
import { loadClientFacts } from "@/lib/portal/clientFacts";
import { countPendingReviews } from "@/lib/field/reviewQueue";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { identityOf } from "@/lib/clients/identity";
import PersonaDashboard, { type DashboardClient } from "@/components/portal/PersonaDashboard";
import ClientRoster from "@/components/therapist/ClientRoster";

export const dynamic = "force-dynamic";

/**
 * Where a clinician lands, shaped by what they do for a living.
 *
 * Branching happens once, here, on `Discipline` — never on `UserRole`. A nurse
 * practitioner and a social case worker are both `THERAPIST`, so keying this
 * off role would hand them the same screen, which is the thing being fixed.
 *
 * Somebody with no discipline set, or who chose "Other", gets the roster they
 * have always had. The layout already shows them a banner asking them to pick
 * one; guessing at a portal for work we know nothing about would be worse than
 * the screen they are used to.
 */

/** How many clients the dashboard shows before it defers to the full roster. */
const RECENT_LIMIT = 6;

export default async function TherapistHome() {
  const user = await requireRole(["THERAPIST", "OWNER"]);
  const persona = personaFor(user.discipline);

  if (persona.kind === "GENERIC") {
    return <ClientRoster user={user} />;
  }

  const clients = await prisma.client.findMany({
    where: {
      practiceId: user.practiceId,
      ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
    },
    // Same ordering as the roster: active first, then most recently seen. A
    // discharged client can still appear — the guardrail explains itself at
    // write time, and hiding them here would make a status change invisible.
    orderBy: [{ status: "asc" }, { lastEncounterAt: "desc" }],
    take: RECENT_LIMIT,
    select: {
      id: true,
      clientCode: true,
      status: true,
      lastEncounterAt: true,
      givenNameEnc: true,
      familyInitial: true,
      initials: true,
      birthYear: true,
    },
  });

  // Only pay for the review count where the persona actually shows one.
  const wantsReview = persona.nav.some((item) => item.href === "/t/review");

  const [facts, pendingReviews] = await Promise.all([
    loadClientFacts(
      user.practiceId,
      clients.map((c) => c.id),
      persona.clientFacts
    ),
    wantsReview ? countPendingReviews(user.id, user.practiceId) : Promise.resolve(0),
  ]);

  const rows: DashboardClient[] = clients.map((client) => ({
    id: client.id,
    clientCode: client.clientCode,
    displayName: identityOf(client).displayName ?? client.initials,
    status: client.status,
    lastEncounterAt: client.lastEncounterAt,
    facts: facts.get(client.id) ?? {},
  }));

  return (
    <PersonaDashboard
      persona={persona}
      userName={user.fullName}
      disciplineLabel={
        user.discipline ? DISCIPLINE_LABEL[user.discipline] : persona.title
      }
      pendingReviews={pendingReviews}
      clients={rows}
    />
  );
}
