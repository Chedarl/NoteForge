"use client";

import { useActionState, useState } from "react";
import { Copy, Check, Link2 } from "lucide-react";
import { addFieldAgent, withdrawFieldLink, type AgentState } from "@/lib/field/manage";
import { DISCIPLINE_LABEL, DISCIPLINE_OPTIONS } from "@/lib/intake/disciplines";

/**
 * Creating a worker's way in, and showing it once.
 *
 * The link is displayed exactly once, on the screen that made it, with a copy
 * button and a sentence saying so. There is no route that can show it again —
 * only a new one can be minted — because a credential that can be re-read from
 * a settings page is a credential that leaks the first time somebody shares
 * their screen.
 */
export function AddFieldAgentForm() {
  const [state, action, pending] = useActionState<AgentState, FormData>(addFieldAgent, {});
  const [copied, setCopied] = useState(false);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard is refused in some in-app browsers; the field below is
      // selectable, which is why it is a readonly input and not a paragraph.
    }
  }

  return (
    <div className="space-y-3">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="block">
          <span className="nf-label">Worker&rsquo;s name</span>
          <input name="fullName" required placeholder="Dana R" className="nf-field mt-1" />
        </label>
        <label className="block">
          <span className="nf-label">Kind</span>
          <select name="discipline" defaultValue="RECOVERY_COACH" className="nf-field mt-1">
            {DISCIPLINE_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {DISCIPLINE_LABEL[d]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className="nf-btn nf-btn-primary h-[42px]">
          {pending ? "Creating…" : "Create link"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      {state.created ? (
        <div className="rounded-lg border border-teal-300 bg-teal-50 p-3.5">
          <p className="text-sm font-semibold text-teal-900">
            {state.created.name}&rsquo;s link is ready
          </p>
          <p className="mt-1 text-xs leading-relaxed text-teal-800">
            Send it to them now and keep a copy if you want one. This is the only time it can be
            shown — if it is lost, create another and withdraw this one.
          </p>
          <div className="mt-2.5 flex gap-2">
            <input
              readOnly
              value={state.created.url}
              onFocus={(e) => e.currentTarget.select()}
              className="nf-field flex-1 font-mono text-xs"
              aria-label="Field worker link"
            />
            <button
              type="button"
              onClick={() => copy(state.created!.url)}
              className="nf-btn nf-btn-secondary shrink-0"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WithdrawLinkForm({ linkId, name }: { linkId: string; name: string }) {
  const [state, action, pending] = useActionState<AgentState, FormData>(withdrawFieldLink, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="linkId" value={linkId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-semibold text-rose-700 underline underline-offset-2"
        aria-label={`Withdraw ${name}'s link`}
      >
        {pending ? "Withdrawing…" : "Withdraw"}
      </button>
      {state.error ? <span className="ml-2 text-xs text-slate-500">{state.error}</span> : null}
    </form>
  );
}

export function FieldLinkHint() {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-slate-600">
      <Link2 size={13} className="mt-0.5 shrink-0" />
      <span>
        A field worker taps their link and sends an update per client — no account, no password.
        Updates arrive in the queue like any other, and the status guardrail refuses a discharged
        client just the same.
      </span>
    </p>
  );
}
