"use client";

import { CALLING_CODES, splitE164 } from "@/lib/sharing/phone";

/**
 * A country code beside the number, rather than hidden inside it.
 *
 * The field this replaces was a single box that accepted anything and prefixed
 * a `+`. A clinician typing the number the way they say it — with the local
 * leading zero, without a country code — got a valid-looking number for the
 * wrong country, and the send reported success while opening WhatsApp on
 * nobody. Making the code an explicit choice is the whole fix; the validation
 * behind it refuses rather than guesses.
 *
 * A full international number pasted into the right-hand box still wins, so
 * anyone outside the short list is never stuck.
 */
export default function CallingCodeField({
  defaultCode = "1",
  defaultPhone = "",
  label = "Send to this WhatsApp number",
  optional = true,
}: {
  defaultCode?: string;
  defaultPhone?: string;
  label?: string;
  optional?: boolean;
}) {
  /*
   * A stored number arrives as E.164 and has to be taken apart before it can be
   * shown, because the code lives in the select and the rest in the text box.
   * Dropping the whole `+234…` into the text box left it beside a selector
   * still reading `+1`, which is a number displayed as two countries at once.
   */
  const prefill = splitE164(defaultPhone);
  const code = defaultPhone ? prefill.code : defaultCode;

  return (
    <div>
      <span className="block text-xs font-medium text-slate-700">
        {label}{" "}
        {optional ? <span className="font-normal text-slate-500">(optional)</span> : null}
      </span>
      <div className="mt-1 flex gap-2">
        <select
          name="callingCode"
          defaultValue={code}
          aria-label="Country code"
          className="w-[9.5rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
        >
          {CALLING_CODES.map((c) => (
            /* `c.label` — "Nigeria (+234)" — and not `+{c.code}`. The list was
               rendering bare codes, so the dropdown read +1, +44, +237, +234,
               +233 … with nothing to say which country any of them was. */
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          defaultValue={prefill.national}
          placeholder="712 345 678"
          aria-label="Phone number"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
        />
      </div>
      <p className="mt-1 text-[0.7rem] leading-relaxed text-slate-500">
        A leading zero is dropped automatically. Pasting a full number that starts with
        <span className="font-medium"> + </span>
        uses that country instead.
        {optional ? " Leave the number blank to choose the contact in WhatsApp." : ""}
      </p>
    </div>
  );
}
