import "server-only";

import { sendMail, emailConfigured } from "@/lib/email/send";

/**
 * Sending a note writer their document by email.
 *
 * ## Why a link and not an attachment
 *
 * The ask was "send it as a PDF by email", and this sends a link that opens
 * that PDF. The difference is not pedantry, and it is the same decision already
 * made for WhatsApp — recorded in CLAUDE.md, where `sendLink` replaced
 * `sendDocument` on every path.
 *
 * An attached PDF is a copy of a full clinical narrative — risk levels,
 * medication, substance use — deposited permanently into an inbox nobody here
 * controls, then synced to a phone, backed up to a cloud, and forwarded by
 * anyone who receives it. There is no expiry, no download ceiling, and no way
 * to withdraw it afterwards. Resend, like Meta, signs no business associate
 * agreement on the tier this runs on.
 *
 * A link keeps the bytes in the practice's own bucket, where all three of those
 * controls apply, and what survives in somebody's mailbox is a URL that has
 * since stopped working. The recipient still opens a PDF; they simply do not
 * keep an unrevokable copy of one.
 *
 * If a customer genuinely requires an attachment, that is a product decision
 * with a BAA attached to it, not a code change to make quietly.
 *
 * ## What is in the message
 *
 * Nothing clinical, and no identifier — not even a client code. `send.ts` rule
 * 1 is that every email this system sends is a *pointer*, and an email subject
 * line shows on a lock screen exactly as a WhatsApp preview does. The recipient
 * knows what they asked for; the message only has to tell them it is ready.
 */

export interface EmailShareResult {
  ok: boolean;
  /** Why not, in words a sender can act on. */
  error?: string;
}

/** A single address, validated enough to fail early rather than at the API. */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 3 && trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * The message itself, separated from sending it.
 *
 * Exported because it is the part worth testing, and testing it through
 * `emailShareLink` would mean intercepting a network call or re-deriving the
 * body in the test — and a test that rebuilds the string it is checking passes
 * whatever this function later does. What must never appear here (a client
 * code, six digits that could be the passcode) is a real constraint, so the
 * assertion has to run against the real output.
 */
export function composeShareEmail(args: {
  downloadUrl: string;
  ttlHours: number;
  locked: boolean;
  senderName: string;
  practiceName: string;
}): { subject: string; text: string } {
  const lines = [
    `${args.senderName} at ${args.practiceName} has prepared a document for note production.`,
    "",
    args.downloadUrl,
    "",
    `The link expires in ${args.ttlHours} hours and is limited to 10 downloads.`,
  ];

  if (args.locked) {
    lines.push(
      "",
      "It is protected by a six-digit code, which is not in this email. Ask the sender for it.",
      "Five wrong attempts and the link stops working permanently."
    );
  }

  lines.push(
    "",
    "If you were not expecting this, please ignore it and tell the sender.",
    "No patient information is contained in this message."
  );

  return {
    // No client code, no date, no template name. A subject line shows on a lock
    // screen, and "RVN-0142" beside a clinical service is an identifier.
    subject: "A document is ready for note production",
    text: lines.join("\n"),
  };
}

export async function emailShareLink(args: {
  to: string;
  downloadUrl: string;
  ttlHours: number;
  /** True when the recipient will be asked for a six-digit code. */
  locked: boolean;
  /** Who it is from, so the message is not anonymous. Never a client's name. */
  senderName: string;
  practiceName: string;
}): Promise<EmailShareResult> {
  if (!looksLikeEmail(args.to)) {
    return { ok: false, error: "That email address does not look right." };
  }

  /*
   * Said out loud rather than returning a quiet false.
   *
   * `sendMail` is deliberately best-effort — a status change must not fail
   * because email is down — but this is different: the sender is standing at a
   * screen believing they have just delivered a document. A silent no here is
   * how a note writer never receives something everybody thinks they were sent.
   */
  if (!emailConfigured()) {
    return {
      ok: false,
      error:
        "Email is not configured on this deployment, so nothing was sent. Use WhatsApp, or copy the link.",
    };
  }

  const { subject, text } = composeShareEmail(args);
  const sent = await sendMail({ to: args.to.trim(), subject, text });

  return sent
    ? { ok: true }
    : { ok: false, error: "The email could not be sent. The link still works — copy it instead." };
}
