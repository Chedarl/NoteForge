import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { whatsappConfigured } from "@/lib/whatsapp/send";
import { fieldCryptoConfigured } from "@/lib/crypto/field";
import { EXPECTED_MIGRATIONS } from "@/lib/db/migrations.generated";
import { readerConfigured } from "@/lib/ai/reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Is this deployment actually wired up?
 *
 * Written because the question "is the Supabase key set on Vercel?" could not be
 * answered from anywhere except the running deployment itself, and the honest
 * ways to find out otherwise are all bad: read the dashboard, or try to sign up
 * and interpret a failure.
 *
 * **It reports booleans and never values.** Whether a key is present is
 * operational information that the sign-up screen already leaks by failing; what
 * the key *is* is a secret, and no amount of convenience justifies putting it on
 * an endpoint. There is no branch here that can print one.
 *
 * Unauthenticated on purpose: something you have to be signed in to read cannot
 * tell you why signing in is broken.
 */
export async function GET() {
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    // Reported as false. The reason is in the platform's own logs, and echoing
    // a connection error here would print the host and user back to the caller.
  }

  /*
   * Connecting is not the same as being migrated, and the difference is the
   * failure that actually happens: a database created before the latest
   * migration answers `SELECT 1` perfectly while every page touching a newer
   * column throws. That looks like "the app is broken" and is really "migrations
   * were never run", so it is worth telling those two apart in one request.
   *
   * This used to probe two specific things — a `noteWriterWhatsApp` column and
   * the `ShareLink` table — and that was worse than useless, because it read
   * `true` against a database missing `ShareLink.documentKind` and sent someone
   * looking somewhere else entirely. A canary chosen by hand only ever detects
   * the lag it was written for; the migration after it ships and the canary does
   * not move.
   *
   * So compare the ledger instead. Prisma records every applied migration in
   * `_prisma_migrations`, and `EXPECTED_MIGRATIONS` is generated from the
   * migrations directory at build time, which makes this exact by construction
   * for every future migration without anybody remembering to update it.
   */
  let schemaUpToDate = false;
  /*
   * `null` means "could not be determined", and it is deliberately not `[]`.
   *
   * When the database is unreachable there is nothing to ask, and an empty
   * array reads as "nothing is missing" — the same false green this check was
   * written to remove, reintroduced one level up. It was caught the first time
   * this endpoint met a deployment with no database connection at all: it
   * reported `database: false` alongside `missingMigrations: []`, which invites
   * exactly the wrong conclusion.
   */
  let missingMigrations: string[] | null = null;

  /*
   * An absent ledger is not the same as an unmigrated database, and conflating
   * the two produced the worst wrong answer this endpoint has given.
   *
   * The original deployment applied the migration SQL directly — that is how
   * this project was first stood up, because the pooler was unreachable and
   * only Supabase's HTTPS query API was available. Running the SQL that way
   * builds the whole schema and writes nothing to `_prisma_migrations`, because
   * that ledger is Prisma's own bookkeeping rather than part of the migration.
   *
   * So the database ends up complete and unrecorded. Reading "no ledger" as
   * "nothing applied" then reports every migration missing on a database that
   * is fully populated with live data — which is how this endpoint came to say
   * a practice's clients were gone when they were sitting in the tables next
   * door. It is also precisely the state Prisma refuses to migrate, with P3005
   * "the database schema is not empty", so the build says so too.
   *
   * `UNMANAGED` is that state, and it needs baselining rather than migrating.
   */
  type SchemaState = "UP_TO_DATE" | "BEHIND" | "UNMANAGED" | "EMPTY" | "UNKNOWN";
  let schemaState: SchemaState = "UNKNOWN";

  if (database) {
    try {
      const [{ ledger, schema }] = await prisma.$queryRaw<
        { ledger: boolean; schema: boolean }[]
      >`
        SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS ledger,
               to_regclass('public."Client"')             IS NOT NULL AS schema
      `;

      if (ledger) {
        const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
          SELECT migration_name FROM "_prisma_migrations"
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        `;
        const applied = new Set(rows.map((row) => row.migration_name));
        missingMigrations = EXPECTED_MIGRATIONS.filter((name) => !applied.has(name));
        schemaUpToDate = missingMigrations.length === 0;
        schemaState = schemaUpToDate ? "UP_TO_DATE" : "BEHIND";
      } else if (schema) {
        // Tables but no ledger. Nothing is missing in the sense of "lost"; the
        // migrations simply were not recorded, and until they are, none can be
        // applied. Left null rather than listed, because listing them here is
        // what caused the misreading.
        schemaState = "UNMANAGED";
      } else {
        missingMigrations = [...EXPECTED_MIGRATIONS];
        schemaState = "EMPTY";
      }
    } catch {
      // Left UNKNOWN with missingMigrations null: an error here says nothing
      // about what is in the database.
    }
  }

  const supabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const supabaseSecretKey = Boolean(process.env.SUPABASE_SECRET_KEY);

  /*
   * Storage is checked separately from the keys, because having a secret key is
   * not the same as having somewhere to put a file. Photograph upload needs
   * `note-pages` and every share link needs `note-exports`; when a bucket is
   * missing those features fail at the moment of use with an error that looks
   * like a bug in the app rather than a gap in the setup.
   */
  let storagePages = false;
  let storageExports = false;
  if (supabaseUrl && supabaseSecretKey) {
    try {
      const { createAdminClient, BUCKET_PAGES, BUCKET_EXPORTS } = await import(
        "@/lib/supabase/admin"
      );
      const { data } = await createAdminClient().storage.listBuckets();
      const names = new Set((data ?? []).map((b) => b.name));
      storagePages = names.has(BUCKET_PAGES);
      storageExports = names.has(BUCKET_EXPORTS);
    } catch {
      // Both stay false; the keys are reported separately above.
    }
  }

  const checks = {
    database,
    /** False means migrations are pending; `missingMigrations` names them. */
    schemaUpToDate,
    supabaseUrl,
    supabaseAnonKey,
    // Signup creates accounts through the admin API, so without this nobody can
    // register at all — this is the single most common reason a fresh
    // deployment looks broken.
    supabaseSecretKey,
    clientNameEncryption: fieldCryptoConfigured(),
    /** Photograph upload needs this bucket. */
    storageForPhotos: storagePages,
    /** Every WhatsApp share link needs this one. */
    storageForShares: storageExports,
    /*
     * A key is present, which is not the same as the reader working — the key
     * can be revoked, out of credit, or pinned to a model that has been
     * withdrawn. `/api/health/ocr` makes a real call and answers that properly;
     * it is authenticated because it costs money to run. This boolean is the
     * cheap half, and is the one that explains an empty transcript box.
     */
    handwritingReading: readerConfigured(),
    whatsappDelivery: whatsappConfigured(),
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  };

  // Everything a person can sign in and file a typed update without. Photograph
  // upload and share links each need their bucket, so those are not optional if
  // you intend to use them — but they do not stop the core path working.
  const optional = new Set([
    "whatsappDelivery",
    "email",
    "storageForPhotos",
    "storageForShares",
    // Absent, every page simply gets typed — which is the process this
    // replaces, so it cannot be what makes a deployment "not ready".
    "handwritingReading",
  ]);
  const missing = Object.entries(checks)
    .filter(([key, ok]) => !ok && !optional.has(key))
    .map(([key]) => key);

  return NextResponse.json(
    {
      ready: missing.length === 0,
      missing,
      checks,
      /*
       * Named, not just counted. A migration name is not a secret — it is a
       * folder name in the repository — and it is the difference between "the
       * database is behind" and knowing which change never landed. `null` when
       * the database could not be reached to ask.
       */
      missingMigrations,
      /*
       * UP_TO_DATE / BEHIND / UNMANAGED / EMPTY / UNKNOWN. Read this before
       * `missingMigrations`: UNMANAGED means the schema is present but
       * unrecorded, which needs baselining, not migrating, and emphatically
       * does not mean the data is gone.
       */
      schemaState,
      note: "true means the value is present, never what it is.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
