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

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

/**
 * Every text-ish value in the database, read back out.
 *
 * The first version shelled out to `pg_dump`. That works locally and is fragile
 * in CI — a client older than the server aborts with "server version mismatch",
 * which would fail this check for a reason that has nothing to do with
 * encryption. Worse, it would fail *loudly but wrongly*, and a check that cries
 * wolf gets deleted.
 *
 * Enumerating `information_schema` instead is portable, needs no binary, and is
 * a stricter version of the same idea: it does not care which columns anybody
 * thought to encrypt, it reads every `text`, `varchar`, `json` and `jsonb`
 * column in the schema and concatenates the lot. That is what finds the column
 * nobody remembered — which is exactly how `SubmissionFlag.detail`,
 * `Client.statusReason` and `ClientStatusEvent.reason` were caught.
 */
async function readEverything(): Promise<{ text: string; columns: number }> {
  const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying', 'json', 'jsonb')
    ORDER BY table_name, column_name
  `;

  const parts: string[] = [];
  for (const { table_name, column_name } of columns) {
    // Identifiers come from information_schema, not from user input, and are
    // quoted anyway. Values are cast to text so json and jsonb read the same.
    const rows = await prisma.$queryRawUnsafe<Record<string, string | null>[]>(
      `SELECT "${column_name}"::text AS v FROM "${table_name}" WHERE "${column_name}" IS NOT NULL`
    );
    for (const row of rows) if (row.v) parts.push(row.v);
  }

  return { text: parts.join("\n"), columns: columns.length };
}

async function main() {
  const { text: sql, columns } = await readEverything();
  console.log(`Read ${sql.length.toLocaleString()} characters across ${columns} text columns.\n`);

  let failures = 0;

  for (const phrase of MUST_BE_PRESENT) {
    const found = sql.includes(phrase);
    if (!found) failures++;
    console.log(`  ${found ? "ok  " : "FAIL"} readable: ${phrase}`);
  }

  console.log();

  for (const phrase of MUST_BE_ABSENT) {
    // Case-insensitive: the question is whether a person reading the database
    // could understand it, not whether it matches byte for byte.
    const at = sql.toLowerCase().indexOf(phrase.toLowerCase());
    if (at !== -1) {
      failures++;
      // A local database of invented clients, so the excerpt is not a
      // disclosure — and without it you cannot tell which column is at fault.
      console.log(`  FAIL in the clear: "${phrase}"`);
      console.log(`       …${sql.slice(Math.max(0, at - 90), at + 60).replace(/\s+/g, " ")}…`);
    } else {
      console.log(`  ok   sealed: ${phrase}`);
    }
  }

  if (failures > 0) {
    console.error(
      `\n${failures} check(s) failed — clinical text is readable in the database.`
    );
    process.exit(1);
  }
  console.log("\nNo clinical text is readable in the database.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
