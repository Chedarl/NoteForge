"use client";

import { useActionState, useEffect } from "react";
import { createRoundWhatsAppShare, type ShareState } from "@/lib/sharing/actions";

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

      <div>
        <label htmlFor="sharePhone" className="nf-label">
          Send to
        </label>
        <input
          id="sharePhone"
          name="phone"
          type="tel"
          defaultValue={defaultPhone}
          placeholder="Leave blank to pick the contact in WhatsApp"
          className="nf-field"
        />
      </div>

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
