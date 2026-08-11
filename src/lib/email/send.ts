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

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}
