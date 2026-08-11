import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { setPlatformUserStatus } from "@/lib/admin/actions";
import { Card, Pill, Stat } from "@/components/shared/ui";

export const dynamic = "force-dynamic";

export default async function PlatformAdminPage() {
  const admin = await requirePlatformAdmin();
  const [practices, userCount, submissionCount] = await Promise.all([
    prisma.practice.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        users: { orderBy: [{ role: "asc" }, { fullName: "asc" }] },
        _count: { select: { clients: true, submissions: true } },
      },
    }),
    prisma.user.count(),
    prisma.submission.count(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold tracking-[0.18em] text-indigo-600 uppercase">
          Platform administration
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">NoteForge overview</h1>
        <p className="mt-1 text-sm text-slate-600">
          Account health and access controls only. Clinical text is deliberately absent.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Practices" value={practices.length} />
        <Stat label="Users" value={userCount} />
        <Stat label="Submissions" value={submissionCount} />
      </div>

      <div className="space-y-4">
        {practices.map((practice) => (
          <Card key={practice.id} className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
              <div className="flex-1">
                <h2 className="font-semibold">{practice.name}</h2>
                <p className="text-xs text-slate-500">Workspace code {practice.code}</p>
              </div>
              <Pill tone="sky">{practice._count.clients} clients</Pill>
              <Pill>{practice._count.submissions} submissions</Pill>
            </div>
            <div className="divide-y divide-slate-100">
              {practice.users.map((user) => {
                const next = user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
                return (
                  <div key={user.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-52 flex-1">
                      <p className="text-sm font-medium">{user.fullName}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                    <Pill tone={user.isPlatformAdmin ? "sky" : "slate"}>
                      {user.isPlatformAdmin ? "platform admin" : user.role.toLowerCase()}
                    </Pill>
                    <Pill tone={user.status === "ACTIVE" ? "emerald" : "rose"}>
                      {user.status.toLowerCase()}
                    </Pill>
                    {user.id === admin.id ? (
                      <span className="w-20 text-right text-xs text-slate-400">Current user</span>
                    ) : (
                      <form action={setPlatformUserStatus}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input type="hidden" name="status" value={next} />
                        <button
                          className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                            next === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          {next === "ACTIVE" ? "Reactivate" : "Suspend"}
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
