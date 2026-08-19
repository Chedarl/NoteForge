"use client";

import { useActionState, useEffect, useState } from "react";
import { ExternalLink, FileText, MessageCircle, Lock } from "lucide-react";
import { createWhatsAppShare, type ShareState } from "@/lib/sharing/actions";
import CallingCodeField from "@/components/shared/CallingCodeField";

/**
 * Hand a submission to the note writer.
 *
 * The link goes over WhatsApp; the code does not. That split is the whole
 * security model, so the interface has to make it awkward to defeat — which is
 * why this component **stops auto-opening WhatsApp when a code was issued**.
 *
 * It used to jump straight to the messenger the moment the link existed. With a
 * passcode that would sweep the sender past the only screen the six digits are
 * ever shown on, and they would arrive in WhatsApp holding a link nobody can
 * open. Now the code is shown, and opening the messenger is a second, deliberate
 * tap.
 */
export default function ShareOnWhatsApp({
  submissionId,
  defaultPhone,
}: {
  submissionId: string;
  defaultPhone: string;
}) {
  const [state, action, pending] = useActionState<ShareState, FormData>(createWhatsAppShare, {});
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    // Only when there is nothing the sender still needs to read off this screen.
    if (state.success && !state.success.passcode) {
      window.location.assign(state.success.whatsappUrl);
    }
  }, [state.success]);

  if (state.success?.passcode) {
    return (
      <div className="mt-5 rounded-xl border border-teal-300 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-teal-50 p-2 text-teal-700">
            <Lock size={18} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              The link is locked. Here is the code.
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Give these six digits to the recipient <strong>some other way</strong> — say
              them on the phone, or use a different app. Putting them in the same chat as
              the link would undo the point of having them.
            </p>
          </div>
        </div>

        <p className="my-4 text-center font-mono text-4xl font-semibold tracking-[0.28em] tabular-nums text-slate-900">
          {state.success.passcode}
        </p>

        <p className="text-center text-xs text-slate-500">
          This is the only time it is shown. It is not stored anywhere it can be read back.
        </p>

        {state.success.emailedTo ? (
          <p className="mt-3 text-center text-xs text-emerald-700">
            The link was emailed to {state.success.emailedTo}. The code was not — pass it on
            yourself.
          </p>
        ) : null}
        {state.success.emailProblem ? (
          <p role="alert" className="mt-3 text-center text-xs text-amber-700">
            {state.success.emailProblem}
          </p>
        ) : null}

        <a
          href={state.success.whatsappUrl}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#087f8c] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#066b76]"
        >
          <MessageCircle size={17} />
          I have the code — open WhatsApp
        </a>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-teal-200 bg-white/80 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-teal-50 p-2 text-teal-700">
          <FileText size={18} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Send the intake as a PDF</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            NoteForge stores a private PDF and puts an expiring link into WhatsApp — never
            the document itself, so nothing clinical sits in a chat backup. Client names
            are excluded, and the link asks for a six-digit code unless you say otherwise.
          </p>
        </div>
      </div>

      <form action={action} className="mt-4 space-y-3">
        <input type="hidden" name="submissionId" value={submissionId} />
        <CallingCodeField
          defaultPhone={defaultPhone}
          label="Recipient&rsquo;s WhatsApp number"
        />

        {/*
          Email is an alternative route for the same link, not a second copy of
          the document. What lands in the inbox is a URL that expires, counts its
          downloads and can be withdrawn — an attached PDF would be an
          unrevokable copy of a clinical narrative sitting in a mailbox nobody
          here controls. Filled in or left blank; the WhatsApp path is unchanged
          either way.
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
          <span className="mt-1 block text-[0.7rem] leading-relaxed text-slate-500">
            They receive the same expiring link, never the file itself. The code is never
            in the email.
          </span>
        </label>

        <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
          <input
            name="unlocked"
            value="yes"
            type="checkbox"
            className="mt-0.5"
            checked={unlocked}
            onChange={(e) => setUnlocked(e.target.checked)}
          />
          Send without a code — the link alone will open it.
        </label>

        <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
          <input name="acknowledged" value="yes" type="checkbox" required className="mt-0.5" />
          {unlocked
            ? "I understand that anyone who sees this link can download the PDF until it expires or reaches its 10-download limit."
            : "I understand this creates an expiring link to sensitive material, and that I need to pass the code on separately."}
        </label>

        {state.error ? <p role="alert" className="text-xs text-rose-700">{state.error}</p> : null}

        {/*
          Said separately from `error`, because the link was created and works.
          Reporting a failed email as a failed share would send somebody back to
          make a second link they do not need.
        */}
        {state.success?.emailedTo ? (
          <p className="text-xs text-emerald-700">Emailed to {state.success.emailedTo}.</p>
        ) : null}
        {state.success?.emailProblem ? (
          <p role="alert" className="text-xs text-amber-700">
            {state.success.emailProblem}
          </p>
        ) : null}

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
