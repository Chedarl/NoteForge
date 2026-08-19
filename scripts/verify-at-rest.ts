/**
 * Dump the database and read it. Is any clinical text still in the clear?
 *
 * This is the check that actually found things. Column encryption was written,
 * type-checked, linted, built and unit-tested, and three columns were still
 * plaintext afterwards:
 *
 *  - `SubmissionFlag.detail`, holding the contradiction classifier's own words
 *    — "the earlier submission records suicidal ideation denied on direct
 *    questioning".
 *  - `Client.statusReason`, holding "Notified by family 4 weeks after the
 *    event."
 *  - `ClientStatusEvent.reason`, the append-only copy of the same sentence,
 *    which survived even after the client column had been sealed.
 *
 * None of them were in the plan, because the plan was written from a survey of
 * the *obvious* columns. Grepping the artefact is the only method that finds the
 * column nobody thought of, which is the same lesson as unzipping the export.
 *
 * Run: npm run verify:at-rest   (needs a seeded local database and pg_dump)
 *
 * It seeds nothing itself. Point it at a database with the standard seed in it,
 * because the phrases below are the seed's own — that is what makes them safe
 * to assert on and safe to have in a repository.
 */

import { execFileSync } from "child_process";

/**
 * Phrases from `prisma/seed.ts` that are unambiguously clinical.
 *
 * Chosen to be long enough that they cannot appear in base64 by chance, and
 * spread across every column that carries narrative, so a regression in any one
 * of them shows up here.
 */
const MUST_BE_ABSENT = [
  // Submission.fields / rawText
  "settled week",
  "breathlessness",
  "Client reported",
  "sleeping better",
  // Note.body
  "Presents as settled",
  // SubmissionFlag.detail
  "suicidal ideation",
  "meaningful terms",
  // Client.statusReason and ClientStatusEvent.reason
  "sessions paused by agreement",
  "Treatment goals met",
  "Northgate Psychology",
  "Notified by family",
];

/**
 * Things that must still be readable.
 *
 * A dump with nothing in it would pass every assertion above, and a broken
 * `pg_dump` invocation is exactly how that happens. These make the check fail
 * loudly rather than silently pass on an empty file.
 */
const MUST_BE_PRESENT = [
  "RVN-0101", // the client code identifies; that is the design
  "Riverbend", // the practice name is not clinical
  "nfenc1", // and the envelopes are actually there
];

function dump(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  /*
   * Prisma's connection string carries parameters libpq does not accept —
   * `schema`, and the `host=/tmp` that selects a unix socket. Handed to
   * `pg_dump` unchanged they fail with "invalid URI query parameter", which
   * reads like the database being unreachable. Rebuilt here rather than asking
   * for a second environment variable that would drift from the first.
   */
  let dsn: string;
  try {
    const parsed = new URL(url);
    const socket = parsed.searchParams.get("host");
    parsed.search = "";
    if (socket) {
      // A unix socket is passed as the host, and the one in the URL is ignored.
      dsn = `postgresql://${parsed.username}@/${parsed.pathname.replace(/^\//, "")}?host=${socket}&port=${parsed.port || 5432}`;
    } else {
      dsn = parsed.toString();
    }
  } catch {
    dsn = url;
  }

  try {
    return execFileSync("pg_dump", ["--dbname", dsn], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      env: { ...process.env, PATH: `/usr/lib/postgresql/16/bin:${process.env.PATH ?? ""}` },
    });
  } catch (error) {
    console.error("pg_dump failed. Is PostgreSQL reachable and pg_dump on PATH?");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const sql = dump();
console.log(`Dumped ${sql.length.toLocaleString()} bytes.\n`);

let failures = 0;

for (const phrase of MUST_BE_PRESENT) {
  const found = sql.includes(phrase);
  if (!found) failures++;
  console.log(`  ${found ? "ok  " : "FAIL"} readable: ${phrase}`);
}

console.log();

for (const phrase of MUST_BE_ABSENT) {
  // Case-insensitive: the point is whether a person reading the dump could
  // understand it, not whether it matches byte for byte.
  const at = sql.toLowerCase().indexOf(phrase.toLowerCase());
  if (at !== -1) {
    failures++;
    // Print the surrounding row so the offending column is obvious. This is a
    // local development database seeded with invented clients, so the excerpt
    // is not a disclosure.
    const line = sql.slice(Math.max(0, at - 120), at + 60).split("\n").pop();
    console.log(`  FAIL in the clear: "${phrase}"`);
    console.log(`       …${line}…`);
  } else {
    console.log(`  ok   sealed: ${phrase}`);
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} check(s) failed — clinical text is readable in a database dump.`
  );
  process.exit(1);
}
console.log("\nNo clinical text is readable in a database dump.");
