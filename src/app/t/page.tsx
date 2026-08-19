import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { personaFor } from "@/lib/portal/personas";
import { loadClientFacts } from "@/lib/portal/clientFacts";
import { countPendingReviews } from "@/lib/field/reviewQueue";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { identityOf } from "@/lib/clients/identity";
import { displayPolicyFor } from "@/lib/clients/displayPolicy";
import PersonaDashboard, { type DashboardClient } from "@/components/portal/PersonaDashboard";
import ClientRoster from "@/components/therapist/ClientRoster";
import DisciplineForm from "@/components/therapist/DisciplineForm";

export const dynamic = "force-dynamic";

/**
 * Where a clinician lands, shaped by what they do for a living.
 *
 * Branching happens once, here, on `Discipline` — never on `UserRole`. A nurse
 * practitioner and a social case worker are both `THERAPIST`, so keying this
 * off role would hand them the same screen, which is the thing being fixed.
 *
 * Two different answers for two different states, and conflating them is what
 * made this whole feature look like it had not shipped:
 *
 *  - **Nobody has ever asked.** `discipline` is null, which is every account
 *    that existed before the column did — in practice, a whole practice at
 *    once. Those people were falling through to the roster they already had,
 *    behind the same eight nav items, so the honest report was "nothing has
 *    changed". The question gets asked here now, as the page. It is not a
 *    nag: `submitStructuredNote` already refuses to file anything without an
 *    answer, so this is a hard requirement that was being advertised as a
 *    thin amber strip.
 *  - **They answered "Other".** A deliberate "I don't fit one of these", and it
 *    keeps the roster. Guessing at a portal for work we know nothing about
 *    would be worse than the screen they are used to.
 */

/** How many clients the dashboard shows before it defers to the full roster. */
const RECENT_LIMIT = 6;

export default async function TherapistHome() {
  const user = await requireRole(["THERAPIST", "OWNER"]);
  const naming = await displayPolicyFor(user.practiceId);
  /*
   * Asked here rather than left to `/t/profile`, because this is the screen the
   * answer decides. A person who has not answered has no dashboard to be shown
   * — there is no neutral one — and cannot file a note either way.
   */
  if (!user.discipline) {
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Which of these describes your work?
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            It decides what this screen shows you, which templates you are offered, and
            what kind of note gets written from what you submit. Notes cannot be filed
            until it is answered, and it can be changed later under Profile.
          </p>
        </div>

        <DisciplineForm current={null} />

        <p className="text-sm text-slate-500">
          Just want the client list?{" "}
          <a href="/t/clients" className="font-medium underline">
            Your caseload is here.
          </a>
        </p>
      </div>
    );
  }

  const persona = personaFor(user.discipline);

  // "Other" — a deliberate answer, and it keeps the roster.
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
    displayName: identityOf(naming, client).displayName ?? client.initials,
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
