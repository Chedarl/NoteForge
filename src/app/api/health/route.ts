import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { whatsappConfigured } from "@/lib/whatsapp/send";
import { fieldCryptoConfigured } from "@/lib/crypto/field";

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
   * `noteWriterWhatsApp` is the newest column the write screen depends on, which
   * makes it the right canary — if it is missing, `/t/write` cannot render.
   */
  let schemaUpToDate = false;
  if (database) {
    try {
      await prisma.practice.findFirst({ select: { noteWriterWhatsApp: true } });
      await prisma.shareLink.count();
      schemaUpToDate = true;
    } catch {
      // Left false: the migrations have not been applied to this database.
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
    /** False means `npx prisma migrate deploy` has not been run against it. */
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
    whatsappDelivery: whatsappConfigured(),
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  };

  // Everything a person can sign in and file a typed update without. Photograph
  // upload and share links each need their bucket, so those are not optional if
  // you intend to use them — but they do not stop the core path working.
  const optional = new Set(["whatsappDelivery", "email", "storageForPhotos", "storageForShares"]);
  const missing = Object.entries(checks)
    .filter(([key, ok]) => !ok && !optional.has(key))
    .map(([key]) => key);

  return NextResponse.json(
    {
      ready: missing.length === 0,
      missing,
      checks,
      note: "true means the value is present, never what it is.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
