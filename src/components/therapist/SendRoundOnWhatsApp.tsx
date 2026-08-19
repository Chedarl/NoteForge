"use client";

import { useActionState, useEffect } from "react";
import { createRoundWhatsAppShare, type ShareState } from "@/lib/sharing/actions";
import CallingCodeField from "@/components/shared/CallingCodeField";

/**
 * The WhatsApp button that works without Meta's Cloud API.
 *
 * The write screen used to hide everything WhatsApp behind
 * `whatsappConfigured()`, which is false until a Meta Business account, a
 * verified sending number and an approval process are all finished. Until then
 * a clinician saw no button at all — the product's last step simply was not
 * there. This is the path that needs none of that: it opens WhatsApp with the
 * message already composed and the clinician presses send.
 *
 * The document goes as an expiring link rather than an attachment. A browser
 * cannot put a file into WhatsApp; only the Cloud API can. That trade is in the
 * patient's favour anyway — the PDF stays behind a token that expires and
 * counts its downloads instead of living in a chat history forever.
 *
 * Leaving the number blank is deliberate and supported: WhatsApp then asks the
 * clinician to pick the contact, which is faster than typing a number they
 * already have saved.
 */

const initial: ShareState = {};

export default function SendRoundOnWhatsApp({
  submissionIds,
  defaultPhone,
}: {
  submissionIds: string[];
  defaultPhone: string;
}) {
  const [state, action, pending] = useActionState(createRoundWhatsAppShare, initial);

  useEffect(() => {
    // Opening it for them is the whole point of the button.
    if (state.success?.whatsappUrl) window.location.assign(state.success.whatsappUrl);
  }, [state.success?.whatsappUrl]);

  return (
    <form action={action} className="mt-4 space-y-3 border-t border-[color:var(--nf-border)] pt-4">
      <input type="hidden" name="submissionIds" value={submissionIds.join(",")} />

      <CallingCodeField defaultPhone={defaultPhone} label="Send to" />

      {/*
        The same link by email, for a note writer who works from an inbox rather
        than a phone. A link, never an attachment: an attached PDF is an
        unrevokable copy of a clinical narrative in a mailbox nobody here
        controls, while the link expires, counts its downloads and can be
        withdrawn.
      */}
      <label className="block">
        <span className="block text-xs font-medium text-slate-700">
          Also email it <span className="font-normal text-slate-500">(optional)</span>
        </span>
        <input
          type="email"
          name="email"
          autoComplete="off"
          placeholder="notes@yourpractice.com"
          className="nf-field mt-1 w-full"
        />
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
        <input
          name="acknowledged"
          value="yes"
          type="checkbox"
          required
          className="mt-0.5 size-4 accent-[color:var(--nf-accent)]"
        />
        <span>
          I understand anyone holding this link can download the PDF until it expires or
          reaches its download limit.
        </span>
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      )}

      {/* Separate from `error`: the link exists and works even if the mail did not. */}
      {state.success?.emailedTo ? (
        <p className="text-sm text-emerald-700">Emailed to {state.success.emailedTo}.</p>
      ) : null}
      {state.success?.emailProblem ? (
        <p role="alert" className="text-sm text-amber-700">
          {state.success.emailProblem}
        </p>
      ) : null}

      {state.success && (
        <a
          href={state.success.whatsappUrl}
          className="block text-sm font-semibold text-[color:var(--nf-accent)] underline"
        >
          WhatsApp did not open? Open it now
        </a>
      )}

      <button disabled={pending} className="nf-btn nf-btn-primary w-full sm:w-auto">
        {pending ? "Preparing the PDF…" : "Send on WhatsApp"}
      </button>
    </form>
  );
}
