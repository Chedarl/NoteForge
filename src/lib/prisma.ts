import { PrismaClient } from "@prisma/client";

/**
 * Makes a Supabase transaction-pooler URL safe for Prisma, whatever was typed
 * into the dashboard.
 *
 * Port 6543 is PgBouncer in transaction mode: a connection is handed back to
 * the pool after every statement, so the server-side prepared statements Prisma
 * creates by default land on one backend and are looked for on another. The
 * result is a pair of errors that read as database corruption and are nothing
 * of the kind — 42P05 "prepared statement s0 already exists" and 26000
 * "prepared statement s5 does not exist" — appearing at random on whichever
 * page happened to be loaded. `pgbouncer=true` tells Prisma to stop using them.
 *
 * The flag belongs in the connection string, and it kept not being there. The
 * string is copied from a Supabase panel that does not include it, pasted into
 * a Vercel field, and sometimes rewritten by the Supabase integration; every
 * one of those steps drops a hand-appended query parameter. Deriving it from
 * the port is not a workaround for a typo, it is reading the fact off the URL
 * that already states it.
 *
 * Nothing else is touched: an explicit `pgbouncer` setting is left exactly as
 * written, and a URL that is not a Supabase pooler is passed through untouched.
 */
function poolSafeUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not something we can reason about — hand it to Prisma unchanged and let
    // Prisma produce the error about it.
    return raw;
  }

  const isSupabasePooler = url.hostname.endsWith(".pooler.supabase.com");
  const isTransactionPort = url.port === "6543";
  if (!isSupabasePooler || !isTransactionPort) return raw;
  if (url.searchParams.has("pgbouncer")) return raw;

  url.searchParams.set("pgbouncer", "true");
  return url.toString();
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const url = poolSafeUrl(process.env.DATABASE_URL);
  // Passing no override at all keeps Prisma's own env handling, which matters
  // for tooling that constructs a client without DATABASE_URL in scope.
  return url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
