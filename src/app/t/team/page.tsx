import { requireRole } from "@/lib/auth/session";
import { listFieldAgents } from "@/lib/field/manage";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { Card } from "@/components/shared/ui";
import { AddFieldAgentForm } from "@/components/specialist/FieldAgentForms";
import FieldWorkerList from "@/components/specialist/FieldWorkerList";
import { siteUrlConfigured } from "@/lib/email/send";

export const dynamic = "force-dynamic";

/**
 * The clinician's own field workers.
 *
 * Deliberately here rather than only in practice settings. A nurse hands a link
 * to the case worker who visits her client and reads what comes back; putting
 * that behind an administrator adds a person with no clinical relationship to
 * either of them, and makes her wait on somebody else to onboard her own
 * worker.
 *
 * An owner still sees every link in Settings. This page shows only the ones the
 * person looking at it is answerable for.
 */
export default async function TeamPage() {
  const user = await requireRole(["OWNER", "THERAPIST", "SPECIALIST"]);
  const links = await listFieldAgents(user.practiceId, user.id);
  // Read once here rather than inside the client component: a link built from
  // the localhost fallback is handed over looking perfectly normal and opens
  // nothing on the worker's phone, and the only person who sees that is the one
  // person who cannot report it.
  const reachable = siteUrlConfigured();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your field workers</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
          Give a recovery coach or case worker a link and they can send you an update about a
          client from their phone — typed or spoken — without an account or a password.
          Everything they send waits for you to read it before it reaches the people writing
          notes.
        </p>
      </div>

      <Card className="p-5">
        <AddFieldAgentForm clinicianName={user.fullName} linksReachable={reachable} />
      </Card>

      <FieldWorkerList
        rows={links.map((link) => ({
          linkId: link.id,
          name: link.agent.fullName,
          kind: link.agent.discipline
            ? DISCIPLINE_LABEL[link.agent.discipline]
            : "Field worker",
          revoked: Boolean(link.revokedAt),
          useCount: link.useCount,
        }))}
        clinicianName={user.fullName}
        linksReachable={reachable}
      />
    </div>
  );
}
