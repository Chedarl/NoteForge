import "server-only";

import { Resend } from "resend";
import { logSafe } from "@/lib/redact";

/**
 * Outbound email.
 *
 * Two rules, both of which exist because of what this product handles.
 *
 * **1. Nothing clinical goes in an email.** Not a note, not a transcript, not a
 * fragment of one. An email lands in an inbox we do not control, gets forwarded,
 * gets synced to a phone. Every message this module sends is a *pointer*: a
 * client code, a status, and a link to somewhere authenticated. The one
 * exception is the confirmation link, which carries a signed token and a client
 * code — no name, no note, nothing about why the person is in treatment.
 *
 * **2. Failure to send is never failure to act.** With no RESEND_API_KEY the
 * function logs and returns false. The status change still happened, the block
 * still happened, the record is still correct. Email is how we tell somebody
 * sooner; it is not how the system knows things.
 */

export interface MailInput {
  to: string | string[];
  subject: string;
  /** Plain text. Kept plain deliberately — no tracking pixels, no remote images. */
  text: string;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendMail(input: MailInput): Promise<boolean> {
  if (!emailConfigured()) {
    logSafe("email", "not configured — message not sent", { subject: input.subject });
    return false;
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    if (error) {
      logSafe("email", `send failed: ${error.message}`, { subject: input.subject });
      return false;
    }
    return true;
  } catch (error) {
    logSafe("email", "send threw", {
      subject: input.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Where this deployment lives, for links that leave the building.
 *
 * Every outbound link is built from this: WhatsApp share links, invitations,
 * the password-set redirect, status-confirmation links, the roster PDF. So when
 * it is wrong, it is wrong everywhere at once and in a way that is invisible
 * from inside the app — the pages all work, and only the recipient sees it.
 *
 * It was wrong. `NEXT_PUBLIC_SITE_URL` was never set in production, so this
 * returned the development fallback and a clinician sent a note writer
 * `http://localhost:3000/share/<token>`. The document was stored correctly, the
 * token was valid, the row was in the database — and the link opened nothing on
 * anybody's phone.
 *
 * So it is derived rather than depended upon, the same way `DATABASE_URL` is.
 * Vercel already publishes the answer:
 *
 * - `VERCEL_PROJECT_PRODUCTION_URL` is the **stable** production domain, and is
 *   preferred even on a preview deployment. A share link has to outlive the
 *   deployment that made it — it sits in somebody's WhatsApp for days — and
 *   these links are served from a database and a bucket that every deployment
 *   shares, so production can serve one a preview created.
 * - `VERCEL_URL` is per-deployment and changes on every push. A link built from
 *   it dies the next time anybody merges anything, which is worse than a link
 *   that never worked, because it works when you test it. Last resort only.
 *
 * An explicit `NEXT_PUBLIC_SITE_URL` still wins, because that is what a custom
 * domain will need. `localhost` remains only for a laptop with no Vercel
 * variables present at all.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return withScheme(explicit).replace(/\/$/, "");

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return withScheme(production).replace(/\/$/, "");

  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) return withScheme(deployment).replace(/\/$/, "");

  return "http://localhost:3000";
}

/** Vercel's variables carry a bare hostname; a configured one may not. */
function withScheme(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * False when links would be built from the localhost fallback — meaning
 * anything sent out of this deployment is unreachable by its recipient.
 */
export function siteUrlConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
      process.env.VERCEL_URL?.trim()
  );
}
