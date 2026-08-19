import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { Card, Pill } from "@/components/shared/ui";
import {
  AddFieldAgentForm,
  FieldLinkHint,
} from "@/components/specialist/FieldAgentForms";
import { listFieldAgents } from "@/lib/field/manage";
import FieldWorkerList from "@/components/specialist/FieldWorkerList";
import { siteUrlConfigured } from "@/lib/email/send";
import {
  InviteUserForm,
  UserStatusForm,
  WhatsAppSettingsForm,
  SafeModeForm,
} from "@/components/specialist/PracticeSettingsForms";
// DISCIPLINE_LABEL lives in a module with no "use client" precisely so both
// sides can share it. PracticeSettingsForms is a client component, and a plain
// function imported from one into a server component is a client reference
// proxy, not the function — calling it throws at request time, which is what
// took this page down.
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const owner = await requireRole(["OWNER"]);

  const users = await prisma.user.findMany({
    where: {
      practiceId: owner.practiceId,
      // Field agents are listed in their own section with their links; showing
      // them here too would invite somebody to "suspend" one and wonder why no
      // password reset arrives for an account that never existed.
      role: { not: "FIELD_AGENT" },
    },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
  });

  const fieldLinks = await listFieldAgents(owner.practiceId);
  const reachable = siteUrlConfigured();

  /*
   * `findUniqueOrThrow` selects every column on Practice, including
   * `noteWriterWhatsApp` — which arrived in a later migration. On a database
   * that was created but never migrated the column is absent and this page dies
   * with a blank server exception, while most of the rest of the app carries on
   * working. That is the third screen to fail this way, so it is caught here
   * too and reported as what it is.
   */
  let practice: { noteWriterWhatsApp: string | null; safeMode: boolean } | null = null;
  let migrationsPending = false;
  try {
    practice = await prisma.practice.findUnique({
      where: { id: owner.practiceId },
      select: { noteWriterWhatsApp: true, safeMode: true },
    });
  } catch {
    migrationsPending = true;
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold tracking-[0.18em] text-indigo-600 uppercase">
          Workspace administration
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Team and delivery settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Invite people into the correct portal, control their access, and choose where
          completed intake PDFs are handed off.
        </p>
      </div>

      {migrationsPending && (
        <div className="rounded-[var(--nf-radius)] border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm text-amber-900">
          <p className="font-semibold">This deployment&rsquo;s database is behind the code.</p>
          <p className="mt-1">
            The tables exist but the most recent migration has not been applied, so the
            WhatsApp handoff setting cannot be read or saved. Run{" "}
            <code className="font-mono">npx prisma migrate deploy</code> against the
            production database. <a href="/api/health" className="underline">/api/health</a>{" "}
            reports exactly what is configured.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">WhatsApp handoff</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            Clinicians can override this per message; this is the convenient default.
          </p>
          <WhatsAppSettingsForm defaultPhone={practice?.noteWriterWhatsApp ?? ""} />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Client identification</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            §2 of the specification: the code identifies, the name confirms. Safe mode drops
            the second half.
          </p>
          <SafeModeForm safeMode={practice?.safeMode ?? false} />
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold">Invite a team member</h2>
          <p className="mt-1 mb-5 text-sm text-slate-600">
            They receive a secure email link, set their own password, then land in the
            portal assigned to their role.
          </p>
          <InviteUserForm />
        </Card>
      </div>

      <section>
        <div className="mb-3">
          <h2 className="font-semibold">Field workers</h2>
          <p className="mt-1 text-sm text-slate-600">
            Recovery coaches and case workers who send updates from a link instead of signing in.
          </p>
          <FieldLinkHint />
        </div>
        <Card className="p-5">
          <AddFieldAgentForm clinicianName={owner.fullName} linksReachable={reachable} />
          {fieldLinks.length > 0 ? (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <FieldWorkerList
                rows={fieldLinks.map((link) => ({
                  linkId: link.id,
                  name: link.agent.fullName,
                  kind: link.agent.discipline
                    ? DISCIPLINE_LABEL[link.agent.discipline]
                    : "Field worker",
                  revoked: Boolean(link.revokedAt),
                  useCount: link.useCount,
                }))}
                clinicianName={owner.fullName}
                linksReachable={reachable}
              />
            </div>
          ) : null}
        </Card>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">People with access</h2>
            <p className="mt-1 text-sm text-slate-600">Suspension takes effect on their next request.</p>
          </div>
          <Pill tone="sky">{users.length} accounts</Pill>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {users.map((user) => (
              <div key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-52 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{user.fullName}</p>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </div>
                <Pill tone={user.role === "OWNER" ? "sky" : "slate"}>
                  {user.role.toLowerCase()}
                </Pill>
                <span className="min-w-36 text-xs text-slate-500">
                  {user.discipline ? DISCIPLINE_LABEL[user.discipline] : "—"}
                </span>
                <Pill tone={user.status === "ACTIVE" ? "emerald" : "rose"}>
                  {user.status.toLowerCase()}
                </Pill>
                {user.id !== owner.id && user.role !== "OWNER" ? (
                  <UserStatusForm userId={user.id} status={user.status} />
                ) : (
                  <span className="w-16 text-right text-xs text-slate-400">You</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
