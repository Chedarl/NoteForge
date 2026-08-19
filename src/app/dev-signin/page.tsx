import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { devAuthEnabled } from "@/lib/auth/devSession";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { signInAsDevUser } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Sign in as any seeded user, without Supabase.
 *
 * Exists so the signed-in half of the product can be opened in a browser on a
 * machine that cannot reach Supabase — which is every development container
 * behind an egress policy, and anyone offline. It is deliberately ugly and
 * deliberately loud: nothing about this screen should be mistakable for the
 * real login, and the banner it plants stays visible on every page afterwards.
 *
 * `notFound()` rather than a redirect when the flag is off, so the route does
 * not exist at all rather than existing and refusing — there is nothing here to
 * discover.
 */
export default async function DevSignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; timedOut?: string }>;
}) {
  if (!devAuthEnabled()) notFound();

  const { next, timedOut } = await searchParams;
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", authUserId: { not: null } },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      discipline: true,
      practice: { select: { name: true } },
    },
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-lg border-2 border-dashed border-rose-400 bg-rose-50 p-4">
        <h1 className="text-lg font-semibold text-rose-900">Development sign-in</h1>
        <p className="mt-1 text-sm text-rose-800">
          This is not the login screen. It sets a cookie naming an existing user and
          skips Supabase entirely, so the application can be opened on a machine that
          cannot reach it. It is off unless <code>DEV_AUTH=1</code>, and it cannot be
          switched on in a production build or on any deployment — this page answers
          404 there.
        </p>
      </div>

      {timedOut ? (
        <p role="status" className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
          Signed out after a period of inactivity — the same rule the real login enforces.
        </p>
      ) : null}

      {users.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600">
          No users in this database. Run <code>npx prisma db seed</code> first.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {users.map((user) => (
            <li key={user.id}>
              <form action={signInAsDevUser}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="next" value={next ?? "/t"} />
                <button className="flex w-full items-center justify-between gap-4 rounded-lg border border-slate-300 bg-white px-4 py-3 text-left hover:border-slate-500">
                  <span>
                    <span className="block text-sm font-medium">{user.fullName}</span>
                    <span className="block text-xs text-slate-500">
                      {user.email ?? "no email"} · {user.practice.name}
                    </span>
                  </span>
                  <span className="text-xs text-slate-600">
                    {user.discipline ? DISCIPLINE_LABEL[user.discipline] : user.role}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
