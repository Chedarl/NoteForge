/**
 * A way in when there is no Supabase to sign in to.
 *
 * The product's identity comes from Supabase Auth, which is unreachable from a
 * development container behind an egress policy and from anywhere offline. That
 * left the whole signed-in half of the application unrunnable locally: you could
 * type-check a form, render it to a string and file a submission from a script,
 * but you could not open it in a browser and press the button. Two real bugs in
 * this codebase — the export that read "not recorded" everywhere, and the
 * portal action that pointed at a page with no microphone — were the kind that
 * only show up when somebody actually uses the thing.
 *
 * So: an explicit, development-only door. It is **not** a second authentication
 * system. It sets one cookie holding an `authUserId` that already exists in the
 * database, and `getSessionUser` looks it up exactly as it looks up the id
 * Supabase would have returned. Every role check, practice scope, guardrail and
 * audit row downstream is unchanged, which is the point — a development sign-in
 * that skipped any of them would be verifying a different product.
 *
 * ## Why it cannot be turned on in production
 *
 * Three gates, and the first two are structural rather than a promise:
 *
 *  1. `NODE_ENV === "production"` — set by `next build` and `next start`. The
 *     route still compiles into the bundle; it simply answers 404 there, and no
 *     environment variable can change that.
 *  2. `VERCEL` — set on every Vercel deployment, preview included. A preview
 *     shares the production database, so it must never accept this either.
 *  3. `DEV_AUTH=1` — off unless somebody deliberately turns it on locally.
 *
 * All three must pass. It fails closed on an unset variable, and `/api/health`
 * reports the answer so a deployment that somehow had it on would say so.
 *
 * Edge-safe on purpose: the middleware runs here, so this file reads
 * environment variables and nothing else. No `server-only`, no Prisma, no
 * secrets.
 */

/** Holds an `authUserId`. Nothing signed — it grants nothing outside development. */
export const DEV_AUTH_COOKIE = "nf_dev_auth";

export function devAuthEnabled(): boolean {
  // A production build has this branch dead. Checked first, and separately from
  // the opt-in, so no combination of environment variables reaches past it.
  if (process.env.NODE_ENV === "production") return false;
  // Any Vercel deployment, previews included: one Supabase project sits behind
  // every environment, so a preview is talking to the production database.
  if (process.env.VERCEL) return false;
  return process.env.DEV_AUTH === "1";
}
