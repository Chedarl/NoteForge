"use client";

import { useActionState, useEffect } from "react";
import { ExternalLink, FileText, MessageCircle } from "lucide-react";
import { createWhatsAppShare, type ShareState } from "@/lib/sharing/actions";
import CallingCodeField from "@/components/shared/CallingCodeField";

export default function ShareOnWhatsApp({
  submissionId,
  defaultPhone,
}: {
  submissionId: string;
  defaultPhone: string;
}) {
  const [state, action, pending] = useActionState<ShareState, FormData>(createWhatsAppShare, {});

  useEffect(() => {
    if (state.success?.whatsappUrl) window.location.assign(state.success.whatsappUrl);
  }, [state.success?.whatsappUrl]);

  return (
    <div className="mt-5 rounded-xl border border-teal-200 bg-white/80 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-teal-50 p-2 text-teal-700">
          <FileText size={18} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Send the intake as a PDF</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            NoteForge creates a private PDF and places its expiring link into WhatsApp. The
            PDF is not posted publicly and client names are excluded.
          </p>
        </div>
      </div>

      <form action={action} className="mt-4 space-y-3">
        <input type="hidden" name="submissionId" value={submissionId} />
        <CallingCodeField
          defaultPhone={defaultPhone}
          label="Recipient&rsquo;s WhatsApp number"
        />
        <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
          <input name="acknowledged" value="yes" type="checkbox" required className="mt-0.5" />
          I understand that anyone holding this link can download the sensitive PDF until it
          expires or reaches its 10-download limit.
        </label>
        {state.error ? <p role="alert" className="text-xs text-rose-700">{state.error}</p> : null}
        {state.success ? (
          <a
            href={state.success.whatsappUrl}
            className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 underline"
          >
            WhatsApp did not open? Open it now <ExternalLink size={12} />
          </a>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#087f8c] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#066b76] disabled:opacity-60 sm:w-auto"
        >
          <MessageCircle size={17} />
          {pending ? "Preparing secure PDF…" : "Create PDF & open WhatsApp"}
        </button>
      </form>
    </div>
  );
}
