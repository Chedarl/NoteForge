import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * The page a deployment shows when its database is behind its code.
 *
 * Unauthenticated on purpose, and for the same reason `/api/health` is: the
 * condition being reported is one that breaks signing in, so a page you have to
 * be signed in to read could never be reached at the moment it is needed.
 *
 * It names the fix rather than apologising. Every screen that reached here did
 * so because a query touched a column that is not in the database yet, and the
 * single command below is the whole remedy — there is no support path, no
 * retry, and nothing the person reading it can do inside the product.
 */
export default function SetupRequiredPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-16">
      <p className="text-xs font-semibold tracking-[0.18em] text-amber-600 uppercase">
        Deployment setup
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
        This deployment&rsquo;s database is behind its code
      </h1>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-slate-600">
        The database is reachable, but it is missing tables or columns this version of
        the application expects. Signing in reads one of those columns, so nobody can get
        in until the migrations are applied. No data has been lost.
      </p>

      <div className="mt-6 rounded-[var(--nf-radius)] border border-slate-200 bg-slate-50 px-4 py-3.5">
        <p className="text-sm font-semibold text-slate-900">Apply the migrations</p>
        <pre className="mt-2 overflow-x-auto font-mono text-xs text-slate-700">
          npx prisma migrate deploy
        </pre>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Run against the production database, with <code className="font-mono">DIRECT_URL</code>{" "}
          pointing at the session pooler on port 5432 — the transaction pooler on 6543
          cannot run migrations. Every deployment built from this commit onwards applies
          them automatically, so this should be needed once.
        </p>
      </div>

      <p className="mt-6 text-sm text-slate-600">
        <Link href="/api/health" className="font-medium text-indigo-600 underline">
          /api/health
        </Link>{" "}
        reports which parts are configured — it answers with true or false and never with
        a secret. <code className="font-mono">schemaUpToDate</code> turns true once this
        is resolved.
      </p>
    </main>
  );
}
