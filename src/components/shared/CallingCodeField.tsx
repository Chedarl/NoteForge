"use client";

import { CALLING_CODES } from "@/lib/sharing/phone";

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
  return (
    <div>
      <span className="block text-xs font-medium text-slate-700">
        {label}{" "}
        {optional ? <span className="font-normal text-slate-500">(optional)</span> : null}
      </span>
      <div className="mt-1 flex gap-2">
        <select
          name="callingCode"
          defaultValue={defaultCode}
          aria-label="Country code"
          className="w-[7.5rem] shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
        >
          {CALLING_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              +{c.code}
            </option>
          ))}
        </select>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          defaultValue={defaultPhone}
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
