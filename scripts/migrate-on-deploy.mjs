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
 * It is skipped entirely without `DIRECT_URL`, which is the local case: a
 * developer running `npm run build` on a laptop should not have their database
 * migrated as a side effect of type-checking.
 *
 * It is also skipped on Vercel preview builds. There is one Supabase project
 * behind every environment, so a preview shares the production database — and
 * a preview build is produced from a branch nobody has reviewed or merged yet.
 * Left ungated, opening a pull request would apply that branch's migrations to
 * the live database, and a migration that drops or renames a column would break
 * production while the change was still being discussed. Previews render against
 * whatever schema production is on, and say so when that schema is behind.
 */

const directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!directUrl) {
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

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
  shell: false,
});

if (result.status === 0) {
  console.log("[migrate] Database is up to date.");
  process.exit(0);
}

// Loud, and specific about what to do — this text ends up in a build log that
// somebody reads only when something is already wrong.
console.error(
  [
    "",
    "[migrate] ******************************************************************",
    "[migrate] MIGRATIONS DID NOT APPLY. The build continues, but the database is",
    "[migrate] behind the code and some screens will say so instead of working.",
    "[migrate]",
    "[migrate] Check DIRECT_URL points at the session pooler (port 5432, not the",
    "[migrate] transaction pooler on 6543 — migrations need a direct connection).",
    "[migrate] Then visit /api/health on the deployment: `schemaUpToDate` tells",
    "[migrate] you whether this resolved itself.",
    "[migrate] ******************************************************************",
    "",
  ].join("\n")
);

process.exit(0);
