"use client";

import { useState } from "react";
import { Check, Copy, Mail, MessageCircle, MessageSquare } from "lucide-react";
import { CALLING_CODES, PHONE_PROBLEM_MESSAGE, toE164 } from "@/lib/sharing/phone";

/**
 * Handing a worker their link, from the phone in the clinician's hand.
 *
 * ## Why every one of these is built in the browser
 *
 * The link *is* the credential. Nothing here posts it back to a server action,
 * because a server action would put the plaintext token into a request body,
 * and from there into whatever the platform keeps of request bodies — logs,
 * traces, an error report captured on a bad day. The token already exists in
 * this component's props, so composing a `wa.me` / `sms:` / `mailto:` URL from
 * it locally costs nothing and keeps the only copy in the place it was already
 * going to be.
 *
 * That is also why there is no "resend" anywhere in the product. This screen is
 * the one moment the token is knowable; a lost link is replaced, not recovered.
 *
 * ## Why three channels and a copy button
 *
 * A recovery coach doing doorstep visits is reachable on WhatsApp or SMS, and
 * often not on email at all. Copy is the escape hatch for everyone else —
 * Signal, a work chat, reading it down the phone.
 */

function messageFor(workerName: string, url: string, clinicianName: string): string {
  // Second person, no client identifiers, and it says what the link is for.
  // A bare URL arriving on someone's phone looks like a phishing attempt, and a
  // worker who is unsure whether to trust it simply does not use it.
  return (
    `Hi ${workerName}, it's ${clinicianName}. ` +
    `This is your private link for sending me updates about the clients we share. ` +
    `Open it on your phone, pick the client, and either type what happened or record a voice note — ` +
    `there's no account and no password to remember.\n\n` +
    `${url}\n\n` +
    `Everything you send comes to me first. I read it, then pass it on for the notes to be written. ` +
    `Please keep this link to yourself — it's yours.`
  );
}

export default function ShareFieldLink({
  workerName,
  url,
  clinicianName,
}: {
  workerName: string;
  url: string;
  clinicianName: string;
}) {
  const [code, setCode] = useState("1");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const body = messageFor(workerName, url, clinicianName);
  const subject = `Your NoteForge link for sending client updates`;

  /**
   * Resolves the number, or explains itself and refuses.
   *
   * Deliberately the same refusal the WhatsApp share on the send page makes: a
   * national number without a country code used to be prefixed with `+` and
   * opened WhatsApp on nobody, reporting success the whole way.
   */
  function dial(): string | null {
    const result = toE164(phone, code);
    if (!result.ok) {
      setProblem(PHONE_PROBLEM_MESSAGE[result.problem]);
      return null;
    }
    setProblem(null);
    return result.e164;
  }

  function openWhatsApp() {
    const e164 = dial();
    if (!e164) return;
    // wa.me wants the number without its leading +.
    window.open(
      `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(body)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function openSms() {
    const e164 = dial();
    if (!e164) return;
    // `?&body=` is the form iOS accepts; Android accepts it too.
    window.location.assign(`sms:${e164}?&body=${encodeURIComponent(body)}`);
  }

  function openEmail() {
    const to = email.trim();
    if (!to) {
      setProblem("Enter their email address, or send it on WhatsApp instead.");
      return;
    }
    setProblem(null);
    window.location.assign(
      `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
        subject
      )}&body=${encodeURIComponent(body)}`
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Refused in some in-app browsers. The readonly input below is
      // selectable, which is why it is an input and not a paragraph.
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="nf-field flex-1 font-mono text-xs"
          aria-label={`${workerName}'s link`}
        />
        <button type="button" onClick={copy} className="nf-btn nf-btn-secondary shrink-0">
          {copied ? <Check size={15} /> : <Copy size={15} />}
          <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <span className="nf-label">Send it to {workerName}</span>

        <div className="mt-1.5 flex gap-2">
          <select
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Country code"
            className="nf-field w-[6.5rem] shrink-0"
          >
            {CALLING_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                +{c.code}
              </option>
            ))}
          </select>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="712 345 678"
            aria-label="Their phone number"
            className="nf-field min-w-0 flex-1"
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openWhatsApp}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#087f8c] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#066b76]"
          >
            <MessageCircle size={16} /> WhatsApp
          </button>
          <button type="button" onClick={openSms} className="nf-btn nf-btn-secondary">
            <MessageSquare size={15} />
            <span className="ml-1.5">Text message</span>
          </button>
        </div>

        <div className="mt-2.5 flex gap-2 border-t border-slate-100 pt-2.5">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="their@email.com"
            aria-label="Their email address"
            className="nf-field min-w-0 flex-1"
          />
          <button type="button" onClick={openEmail} className="nf-btn nf-btn-secondary shrink-0">
            <Mail size={15} />
            <span className="ml-1.5">Email</span>
          </button>
        </div>

        {problem ? (
          <p role="alert" className="mt-2 text-xs text-rose-700">
            {problem}
          </p>
        ) : null}

        <p className="mt-2 text-[0.7rem] leading-relaxed text-slate-500">
          Your message app opens with the link and a short explanation already written. Nothing is
          sent until you press send there, and NoteForge never stores the number.
        </p>
      </div>
    </div>
  );
}
