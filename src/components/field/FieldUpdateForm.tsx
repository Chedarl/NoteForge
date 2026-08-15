"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Check, AlertTriangle } from "lucide-react";
import { submitFieldUpdate, type FieldUpdateState } from "@/lib/field/actions";
import { speechSupported, startDictation, type Dictation } from "@/lib/voice/speech";

/**
 * One client, one update, on a phone, outdoors, possibly in a hurry.
 *
 * Every decision here follows from that sentence. Three fields and nothing
 * else. The date defaults to today because it almost always is. Dictation is
 * offered but never required, and the text box stays editable while it runs —
 * a recogniser that mishears "Suboxone" must be correctable without starting
 * again.
 *
 * The form is not cleared on success. A worker filing six contacts in a row
 * changes the name and keeps going, and re-typing the date each time is the
 * kind of friction that ends with updates not being filed at all.
 */
export default function FieldUpdateForm({
  token,
  agentName,
  supervisorName,
}: {
  token: string;
  agentName: string;
  /**
   * The clinician who gave out this link, when there is one. Named on the page
   * rather than left implicit: a worker writing for "the office" writes
   * differently from one writing for the nurse who knows the client, and one
   * who does not know an update gets read before it becomes a note cannot judge
   * how much to explain.
   */
  supervisorName: string | null;
}) {
  const [state, action, pending] = useActionState<FieldUpdateState, FormData>(
    submitFieldUpdate,
    {}
  );

  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const dictation = useRef<Dictation | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  // Checked after mount: the server has no idea what the phone can do, and
  // rendering a button that turns out to do nothing is worse than not offering
  // it.
  useEffect(() => setSupported(speechSupported()), []);

  // A recogniser left running when the page closes keeps the microphone hot.
  useEffect(() => () => dictation.current?.stop(), []);

  function toggle() {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    setMicNote(null);
    setListening(true);
    dictation.current = startDictation({
      onPhrase: (text) => {
        const field = box.current;
        if (!field) return;
        // Appended, never replaced. Whatever the worker typed by hand survives.
        field.value = field.value ? `${field.value.trimEnd()} ${text}` : text;
        field.scrollTop = field.scrollHeight;
      },
      onError: (reason) => {
        setMicNote(reason);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div>
        <label htmlFor="clientName" className="nf-label">
          Who did you see?
        </label>
        <input
          id="clientName"
          name="clientName"
          required
          autoComplete="off"
          placeholder="Smith J"
          className="nf-field"
        />
        <p className="mt-1 text-xs text-slate-500">
          First name and last initial. The office matches it to the right record.
        </p>
      </div>

      <div>
        <label htmlFor="encounterDate" className="nf-label">
          When
        </label>
        <input
          id="encounterDate"
          name="encounterDate"
          type="date"
          defaultValue={today}
          max={today}
          className="nf-field"
        />
      </div>

      <div>
        <div className="flex items-end justify-between gap-3">
          <label htmlFor="update" className="nf-label">
            What happened
          </label>
          {supported ? (
            <button
              type="button"
              onClick={toggle}
              aria-pressed={listening}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                listening
                  ? "bg-rose-600 text-white"
                  : "border border-[color:var(--nf-border)] bg-white text-slate-700"
              }`}
            >
              {listening ? <MicOff size={14} /> : <Mic size={14} />}
              {listening ? "Stop" : "Speak it"}
            </button>
          ) : null}
        </div>
        <textarea
          id="update"
          name="update"
          ref={box}
          required
          rows={7}
          placeholder="Met at the shelter. Reports sleeping better, still no ID. Denies SI/HI. Agreed to come to the clinic Thursday."
          className="nf-field mt-1 resize-y"
        />
        {listening ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-rose-700">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-600" />
            Listening — speak normally. You can still type.
          </p>
        ) : null}
        {micNote ? <p className="mt-1 text-xs text-amber-700">{micNote}</p> : null}
      </div>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </p>
      ) : null}

      {state.blocked ? (
        <div role="alert" className="flex gap-2.5 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>{state.blocked}</span>
        </div>
      ) : null}

      {state.success ? (
        <div className="flex gap-2.5 rounded-lg bg-teal-50 px-3 py-2.5 text-sm text-teal-900">
          <Check size={17} className="mt-0.5 shrink-0" />
          <span>
            Filed for <strong>{state.success.clientCode}</strong>, {state.success.when}.{" "}
            {state.success.awaitingReview && supervisorName
              ? `${supervisorName} will read it before it goes for writing up.`
              : "It has gone to the office."}{" "}
            Change the name above to send another.
          </span>
        </div>
      ) : null}

      <button type="submit" disabled={pending} className="nf-btn nf-btn-primary w-full justify-center">
        {pending ? "Sending…" : "Send this update"}
      </button>

      <p className="text-center text-xs text-slate-500">
        Sent as {agentName}.{" "}
        {supervisorName
          ? `${supervisorName} reads everything you send here first.`
          : "The office sees it straight away."}
      </p>
    </form>
  );
}
