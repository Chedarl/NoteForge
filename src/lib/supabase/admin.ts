import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the secret key, which bypasses RLS.
 *
 * Used for exactly three things: creating staff accounts, minting short-lived
 * signed upload URLs, and minting short-lived signed *read* URLs for note
 * photographs behind the role-gated media route.
 *
 * Never import this from a client component. The key it carries can read every
 * note photograph in the account.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("Supabase admin credentials are not configured");
  }
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Buckets this application owns. Both private, always. */
export const BUCKET_PAGES = "note-pages";
export const BUCKET_EXPORTS = "note-exports";
