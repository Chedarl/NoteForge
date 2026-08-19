import { requireRole } from "@/lib/auth/session";
import { listFieldAgents } from "@/lib/field/manage";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { Card, Pill } from "@/components/shared/ui";
import {
  AddFieldAgentForm,
  WithdrawLinkForm,
} from "@/components/specialist/FieldAgentForms";

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
        <AddFieldAgentForm clinicianName={user.fullName} />
      </Card>

      {links.length > 0 ? (
        <section>
          <h2 className="mb-2 font-semibold">Links you have given out</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="divide-y divide-slate-100">
              {links.map((link) => (
                <div key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <span className="font-medium text-slate-900">{link.agent.fullName}</span>
                  <span className="text-sm text-slate-500">
                    {link.agent.discipline
                      ? DISCIPLINE_LABEL[link.agent.discipline]
                      : "Field worker"}
                  </span>
                  {link.revokedAt ? (
                    <Pill tone="rose">Withdrawn</Pill>
                  ) : (
                    <Pill tone="emerald">Active</Pill>
                  )}
                  <span className="text-xs text-slate-500">
                    {link.useCount === 0
                      ? "not used yet"
                      : `${link.useCount} update${link.useCount === 1 ? "" : "s"} sent`}
                  </span>
                  <span className="ml-auto">
                    {link.revokedAt ? null : (
                      <WithdrawLinkForm linkId={link.id} name={link.agent.fullName} />
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Withdrawing a link stops it immediately and affects nobody else. Everything that
            person already sent stays exactly where it is.
          </p>
        </section>
      ) : null}
    </div>
  );
}
