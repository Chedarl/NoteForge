"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { quickAddClient } from "@/lib/clients/quickAdd";

/**
 * "They are not on the list" — answered without leaving the note.
 *
 * ## Why a button and not a nested form
 *
 * This sits inside the intake `<form>`, and a form inside a form is invalid
 * HTML that browsers resolve by dropping the inner one — so the outer form
 * would submit instead, filing a half-written note. It calls the server action
 * through a transition, which is the same shape `PreviousSubmission` already
 * uses a few lines below it.
 *
 * ## Why the name box is not `required`
 *
 * A `required` control inside a `<details>` that is closed makes the browser
 * refuse the *outer* submit with "An invalid form control is not focusable" —
 * nothing on screen changes and the note button silently stops working. That
 * trap is documented in CLAUDE.md and it applies to any control added inside
 * this form, not only the template fields. Validation is in the action.
 *
 * ## Why it resolves rather than creates
 *
 * Typing a name that already exists selects that client instead of making a
 * second one. Somebody who cannot find a client in a capped picker is exactly
 * the person about to type their name here, and creating a duplicate would
 * split one person's history across two records — silently, and permanently.
 */
export default function AddClientInline({
  onAdded,
}: {
  /** Hands the new or matched client back so the picker can select it. */
  onAdded: (client: { id: string; clientCode: string; label: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    const typed = name.trim();
    if (typed.length < 2) {
      setError("Type the client's name — for example “Smith J”.");
      return;
    }
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await quickAddClient(typed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onAdded({
        id: result.client.id,
        clientCode: result.client.clientCode,
        label: result.client.label,
      });
      setNote(
        result.client.created
          ? `${result.client.clientCode} created and selected.`
          : `${result.client.clientCode} already existed — selected.`
      );
      setName("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <div className="mt-1.5">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setNote(null);
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--nf-accent)] underline underline-offset-2"
        >
          <UserPlus size={13} />
          Not on the list? Add a client
        </button>
        {note ? <p className="mt-1 text-xs text-emerald-700">{note}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-[color:var(--nf-border)] bg-slate-50 p-3">
      <label htmlFor="quickAddName" className="block text-xs font-medium text-slate-700">
        Client&rsquo;s name
      </label>
      <div className="mt-1 flex flex-wrap gap-2">
        <input
          id="quickAddName"
          // Deliberately not `name=` — this value must never be posted with the
          // note. It is read by the button beside it and nothing else.
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter inside the intake form would otherwise submit the note.
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Smith J"
          autoComplete="off"
          className="nf-field min-w-40 flex-1"
        />
        <button
          type="button"
          onClick={add}
          disabled={pending}
          className="nf-btn nf-btn-primary shrink-0 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add and select"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="nf-btn nf-btn-secondary shrink-0"
        >
          Cancel
        </button>
      </div>
      <p className="mt-1.5 text-[0.7rem] leading-relaxed text-slate-500">
        Surname and initial is enough. They get a practice code straight away, and the name is
        encrypted. If that name is already on your caseload, that client is selected instead of
        a second one being made.
      </p>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
