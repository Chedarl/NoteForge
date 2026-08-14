import { spawnSync } from "node:child_process";

/**
 * Applies pending migrations as part of the deployment build.
 *
 * This exists because the schema and the code went out of step in production
 * and stayed that way: the code shipped on every push, the migrations only ever
 * ran if somebody remembered to run them by hand, and nobody did. Three
 * separate screens died with a blank server error before the cause was found,
 * and each looked like a different bug. Coupling the two removes the whole
 * class of failure — the database that serves a build is migrated by that same
 * build.
 *
 * **A failed migration does not fail the build**, and that is a deliberate
 * trade rather than laziness. The alternative is that a database hiccup, a
 * paused free-tier project or a missing `DIRECT_URL` blocks every deployment
 * including the one that would fix it. The application already detects an
 * out-of-date schema and says so — `/api/health` reports it, and the write,
 * signup and settings screens each explain it rather than crashing — so a
 * migration that did not run is visible rather than silent. Shipping the code
 * that can explain the problem beats shipping nothing.
 *
 * It is skipped entirely when neither `DIRECT_URL` nor `DATABASE_URL` is set,
 * which is the case on a laptop with no `.env`. Note that it does *not* skip
 * merely because `DIRECT_URL` is unset — a local `DATABASE_URL` is used, so
 * `npm run build` against a development database migrates it.
 *
 * It is also skipped on Vercel preview builds. There is one Supabase project
 * behind every environment, so a preview shares the production database — and
 * a preview build is produced from a branch nobody has reviewed or merged yet.
 * Left ungated, opening a pull request would apply that branch's migrations to
 * the live database, and a migration that drops or renames a column would break
 * production while the change was still being discussed. Previews render against
 * whatever schema production is on, and say so when that schema is behind.
 */

/**
 * Works out which connection strings are worth trying, best first.
 *
 * `DIRECT_URL` is the one that should work and repeatedly has not, for a reason
 * that is invisible from the dashboard: Supabase's *direct* host,
 * `db.<ref>.supabase.co`, resolves to an IPv6 address unless the IPv4 add-on is
 * bought, and Vercel's build machines are IPv4-only. So the value that the
 * Supabase Connect panel presents as "the direct connection" — and that the
 * Vercel integration writes for you — is one that can never be reached from the
 * place this script runs. It fails with P1001 every time, the build carries on
 * by design, and the schema silently stays behind the code.
 *
 * Rather than depend on somebody typing the right host into a dashboard, derive
 * it. The *session* pooler is the same host as the transaction pooler on a
 * different port, so a working `DATABASE_URL` already contains everything
 * needed to build a migration connection: swap 6543 for 5432 and drop the
 * pgbouncer flags, because migrations need real prepared statements and their
 * own advisory locks.
 *
 * Order matters. Whatever was configured explicitly is still tried first — if
 * somebody has bought the IPv4 add-on, or is running against a plain Postgres,
 * their setting is correct and this must not override it.
 */
function sessionPoolerVariant(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Only Supabase's poolers are rewritten. Everything else is left exactly as
  // it was given: guessing at ports on an unknown host would turn a clear
  // failure into a confusing one.
  if (!parsed.hostname.endsWith(".pooler.supabase.com")) return null;

  parsed.port = "5432";
  // pgbouncer=true tells Prisma to stop using prepared statements, which is
  // right for the transaction pooler at runtime and wrong for migrations.
  for (const flag of ["pgbouncer", "connection_limit", "pool_timeout", "statement_cache_size"]) {
    parsed.searchParams.delete(flag);
  }
  return parsed.toString();
}

/** Same string twice is one attempt, not two. */
function distinct(urls) {
  const seen = new Set();
  return urls.filter((url) => url && !seen.has(url) && seen.add(url));
}

const candidates = distinct([
  process.env.DIRECT_URL,
  sessionPoolerVariant(process.env.DIRECT_URL),
  sessionPoolerVariant(process.env.DATABASE_URL),
  process.env.DATABASE_URL,
]);

if (candidates.length === 0) {
  console.log("[migrate] No DIRECT_URL or DATABASE_URL set — skipping migrations.");
  process.exit(0);
}

// Unset everywhere that is not Vercel — CI, Docker, a self-hosted runner — and
// those should migrate the database they were handed. Only Vercel's own
// preview and development builds are held back.
const vercelEnv = process.env.VERCEL_ENV;
if (vercelEnv && vercelEnv !== "production") {
  console.log(
    `[migrate] Vercel ${vercelEnv} build — skipping migrations so an unmerged ` +
      "branch cannot alter the shared production schema."
  );
  process.exit(0);
}

console.log("[migrate] Applying any pending migrations…");

/**
 * Never print a connection string. It carries the database password, and a
 * Vercel build log is readable by everyone on the team and by anything with the
 * deployment URL. The host and port are enough to tell the attempts apart.
 */
function describe(url) {
  try {
    const { hostname, port } = new URL(url);
    return `${hostname}:${port || "5432"}`;
  } catch {
    return "an unparseable connection string";
  }
}

let applied = false;

for (const [index, url] of candidates.entries()) {
  console.log(`[migrate] Trying ${describe(url)}…`);

  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    // Prisma reads DIRECT_URL through the schema's `directUrl`, so overriding
    // that variable is what actually redirects the migration.
    env: { ...process.env, DIRECT_URL: url },
    shell: false,
  });

  if (result.status === 0) {
    if (index > 0) {
      console.log(
        `[migrate] Note: the configured DIRECT_URL did not work; ${describe(url)} ` +
          "did. Set DIRECT_URL to that host so this is not rediscovered each build."
      );
    }
    console.log("[migrate] Database is up to date.");
    applied = true;
    break;
  }

  console.error(`[migrate] ${describe(url)} did not work — trying the next candidate.`);
}

if (applied) process.exit(0);

// Loud, and specific about what to do — this text ends up in a build log that
// somebody reads only when something is already wrong.
console.error(
  [
    "",
    "[migrate] ******************************************************************",
    "[migrate] MIGRATIONS DID NOT APPLY. The build continues, but the database is",
    "[migrate] behind the code and some screens will say so instead of working.",
    "[migrate]",
    "[migrate] Every candidate connection was tried and all of them failed, so",
    "[migrate] this is not the usual wrong-host mistake. Check the database is",
    "[migrate] running and not paused, and that DATABASE_URL points at the",
    "[migrate] Supabase pooler (aws-*.pooler.supabase.com), not at",
    "[migrate] db.<ref>.supabase.co — that host is IPv6-only and unreachable",
    "[migrate] from a Vercel build.",
    "[migrate]",
    "[migrate] Then visit /api/health on the deployment: `schemaUpToDate` names",
    "[migrate] the migrations that are still missing.",
    "[migrate] ******************************************************************",
    "",
  ].join("\n")
);

process.exit(0);
