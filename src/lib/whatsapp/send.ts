import "server-only";

import { logSafe } from "@/lib/redact";
import { normalizeWhatsAppNumber } from "@/lib/sharing/phone";

/**
 * Sending a finished PDF to the note writer's WhatsApp.
 *
 * One file, one provider interface, for the same reason `src/lib/ai/reader.ts`
 * is one file: the rest of the application asks for "send this document to this
 * number" and knows nothing about who carries it. Swapping Meta's Cloud API for
 * Twilio, or for a provider that will sign a BAA, is a change to this file and
 * nothing else.
 *
 * ## Read this before putting real patients through it
 *
 * **Meta does not sign a BAA covering WhatsApp.** A PDF sent through here leaves
 * the controlled environment and lands on Meta's infrastructure and in a chat
 * history on somebody's phone. That is a deliberate product decision recorded in
 * `docs/REQUIREMENTS.md` §7a, not an oversight, and the code does what it can to
 * bound it rather than pretend otherwise:
 *
 *  - The caller decides whether the document carries a client name, and the
 *    default everywhere is that it does not. A bundle identified only by
 *    practice code is materially less damaging in a leaked chat backup.
 *  - Every send is written to the audit trail by the caller, with the client
 *    code and whether the document was identifiable, so "what went out over
 *    WhatsApp, to whom, and when" has an answer.
 *  - Nothing clinical goes in the *message text*. The caption is a client code
 *    and a date. The narrative is inside the attachment, which at least has to
 *    be deliberately opened.
 *
 * **Failure to send is never failure to record.** With no credentials this
 * returns `not_configured` and the submission, the PDF and the audit row all
 * still exist — the PDF is downloaded instead. That is the same contract
 * every other outbound integration in this codebase honours: a delivery channel
 * being down must never cost somebody the work they just did.
 */

export type WhatsAppResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "not_configured" | "no_number" | "failed"; detail?: string };

const GRAPH_VERSION = "v21.0";

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * The Graph API wants digits only — no `+`, no spaces, no punctuation.
 *
 * Validation is delegated to `normalizeWhatsAppNumber`, which is what the share
 * flow and the practice settings form already use, so a number accepted in one
 * place cannot be rejected in another. That returns `+digits`; the leading `+`
 * is stripped here because this is the one caller that must not have it.
 */
export function toGraphNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  const normalised = normalizeWhatsAppNumber(input);
  return normalised ? normalised.replace(/^\+/, "") : null;
}

export interface SendDocumentInput {
  to: string;
  pdf: Buffer;
  filename: string;
  /** Client code and date only. Never note text — see the note above. */
  caption: string;
}

/**
 * Push the PDF itself into a chat. **Kept, but no longer the way anything sends.**
 *
 * Meta's Cloud API needs two calls: upload the bytes, then send the id. There is
 * no single-call form that takes a file.
 *
 * Every caller now uses `sendLink` instead, because the bytes landing on Meta's
 * infrastructure and in a phone's cloud backup is the part of this integration
 * that cannot be bounded after the fact — a document sent this way has no
 * expiry, no download ceiling and no way to be withdrawn. This function stays
 * because the capability may be wanted for something genuinely non-clinical,
 * and deleting it would only mean rewriting it worse later.
 *
 * If you are about to call this with a clinical PDF: use `sendLink`.
 */
export async function sendDocument(input: SendDocumentInput): Promise<WhatsAppResult> {
  if (!whatsappConfigured()) {
    logSafe("whatsapp", "not configured — document not sent", { filename: input.filename });
    return { ok: false, reason: "not_configured" };
  }

  const to = toGraphNumber(input.to);
  if (!to) return { ok: false, reason: "no_number" };

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const token = process.env.WHATSAPP_TOKEN!;

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append(
      "file",
      new Blob([new Uint8Array(input.pdf)], { type: "application/pdf" }),
      input.filename
    );

    const upload = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!upload.ok) {
      // The body can echo the request, so it is not logged. Status is enough to
      // tell an expired token from a rejected file.
      logSafe("whatsapp", `media upload failed (${upload.status})`, { filename: input.filename });
      return { ok: false, reason: "failed", detail: `upload ${upload.status}` };
    }

    const { id: mediaId } = (await upload.json()) as { id?: string };
    if (!mediaId) return { ok: false, reason: "failed", detail: "no media id" };

    const send = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "document",
        document: { id: mediaId, filename: input.filename, caption: input.caption },
      }),
    });

    if (!send.ok) {
      logSafe("whatsapp", `send failed (${send.status})`, { filename: input.filename });
      return { ok: false, reason: "failed", detail: `send ${send.status}` };
    }

    const body = (await send.json()) as { messages?: { id: string }[] };
    const messageId = body.messages?.[0]?.id;
    if (!messageId) return { ok: false, reason: "failed", detail: "no message id" };

    return { ok: true, messageId };
  } catch (error) {
    logSafe("whatsapp", "send threw", {
      filename: input.filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "failed", detail: "network" };
  }
}

export interface SendLinkInput {
  to: string;
  /** The `/share/<token>` URL. Never a direct link to the bytes. */
  url: string;
  /** Client codes and a date. Never note text — see the note at the top. */
  lead: string;
}

/**
 * Send the *link*, not the document. This is now the default handoff.
 *
 * Pushing the PDF itself through `sendDocument` put clinical material onto
 * Meta's infrastructure, into a chat history, and into whatever cloud backup
 * that phone has switched on — permanently, with no expiry, no download
 * ceiling, and no way to withdraw it. None of that is covered by an agreement
 * with anybody.
 *
 * A link is a different shape of risk in every dimension that matters. The
 * bytes stay in the practice's own bucket. The link expires, counts its
 * downloads, can be withdrawn after the fact, and — when the document carries
 * names — cannot be opened at all without a code that never travelled through
 * WhatsApp. What sits in the chat backup is a URL that has since stopped
 * working.
 *
 * The recipient's experience barely changes: one tap instead of none, onto a
 * page that tells them what they have been sent. That is a cheap price for
 * moving the clinical payload off a channel nobody will sign for.
 */
export async function sendLink(input: SendLinkInput): Promise<WhatsAppResult> {
  if (!whatsappConfigured()) {
    logSafe("whatsapp", "not configured — link not sent");
    return { ok: false, reason: "not_configured" };
  }

  const to = toGraphNumber(input.to);
  if (!to) return { ok: false, reason: "no_number" };

  try {
    const send = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          // Preview off: a preview makes Meta fetch the URL, and a fetched
          // share URL is a link somebody else's server has now seen.
          text: { preview_url: false, body: `${input.lead}\n\n${input.url}` },
        }),
      }
    );

    if (!send.ok) {
      logSafe("whatsapp", `link send failed (${send.status})`);
      return { ok: false, reason: "failed", detail: `send ${send.status}` };
    }

    const body = (await send.json()) as { messages?: { id: string }[] };
    const messageId = body.messages?.[0]?.id;
    if (!messageId) return { ok: false, reason: "failed", detail: "no message id" };
    return { ok: true, messageId };
  } catch (error) {
    logSafe("whatsapp", "link send threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "failed", detail: "network" };
  }
}

/** What the clinician is told, in plain words, when a send does not happen. */
export function sendFailureMessage(result: Extract<WhatsAppResult, { ok: false }>): string {
  switch (result.reason) {
    case "not_configured":
      return "WhatsApp delivery is not set up on this deployment. The PDF is saved — download it below.";
    case "no_number":
      return "No note-writer WhatsApp number is set for this practice, so nothing was sent. The PDF is saved — download it below.";
    default:
      return "WhatsApp would not accept the document just now. The PDF is saved — download it below, and it can be sent again.";
  }
}
