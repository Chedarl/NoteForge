"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Keep what has been typed, on this device, until it is filed.
 *
 * A clinician fills a twenty-field nursing form on a phone and the phone rings.
 * Or the browser evicts a backgrounded tab, or the battery goes, or they tap a
 * link and come back. Every one of those loses the form today, and the person
 * it happens to does not file a shorter note — they stop using the tool.
 *
 * ## Why the device and not the server
 *
 * A server-side draft would be clinical text about a named client, stored
 * before anybody decided it was a record, with its own retention question and
 * its own row in an export. That is a bigger decision than "do not lose the
 * form", and it is not the one being made here.
 *
 * `localStorage` keeps it on the machine that typed it, which is the same
 * machine it was already sitting in memory on. Nothing new leaves the device.
 *
 * ## What that costs, and what is done about it
 *
 * A shared practice phone is the real risk: an unsent draft about one client
 * left in storage for the next person to open the form. Three things bound it —
 *
 *  - a draft older than `MAX_AGE_HOURS` is discarded on read rather than
 *    offered, so a forgotten one ages out instead of waiting indefinitely;
 *  - it is cleared the moment the form is filed, which is the common case;
 *  - the key includes the client and the template, so a restored draft can
 *    never be silently attached to a different person.
 *
 * It is restored **on request, never automatically**. Overwriting a form
 * somebody has already started with something from yesterday would be its own
 * kind of data loss, and a clinician who does not recognise a draft should be
 * able to say so.
 */

/** After this, an unsent draft is stale enough to throw away rather than offer. */
const MAX_AGE_HOURS = 24;

const PREFIX = "nf_draft:";

/**
 * Form plumbing that is not an answer.
 *
 * A draft is worth keeping when somebody has *written* something. These get
 * filled in by simply opening the page — a client is preselected, a template is
 * chosen, the date defaults to today — so a draft consisting only of these is a
 * draft of nothing.
 */
const NOT_CONTENT = new Set([
  "clientId",
  "templateKind",
  "encounterDate",
  "acknowledged",
  "unlocked",
  "phone",
  "callingCode",
  "sendTo",
  "includeName",
  "saveDefault",
]);

function hasContent(values: Record<string, string | string[]>): boolean {
  return Object.entries(values).some(
    ([name, value]) =>
      !NOT_CONTENT.has(name) &&
      (Array.isArray(value) ? value.length > 0 : value.trim().length > 0)
  );
}

interface StoredDraft {
  savedAt: number;
  values: Record<string, string | string[]>;
}

export interface DraftState {
  /** Present when a draft for this exact form is waiting and still fresh. */
  available: { savedAt: Date } | null;
  /** Answers to restore, once. Null until `restore` is called. */
  restored: Record<string, string | string[]> | null;
  restore: () => void;
  discard: () => void;
  /** Call after a successful submit. */
  clear: () => void;
  /** Call on every change; debounced internally. */
  capture: (form: HTMLFormElement) => void;
  savedAt: Date | null;
}

/**
 * @param key      Identifies the form. Null disables the whole mechanism.
 * @param multiple Names that hold a *list* even when only one is ticked.
 *
 * That second argument exists because `FormData` cannot tell them apart. One
 * ticked checkbox and one text field both come back as a single value, so
 * collapsing on count stored a lone tick as a string — and restoring it put
 * nothing back, because the renderer expects an array and quietly saw none.
 * The form knows which of its fields are lists; storage does not.
 */
export function useFormDraft(
  key: string | null,
  multiple: ReadonlySet<string> = new Set()
): DraftState {
  const [available, setAvailable] = useState<{ savedAt: Date } | null>(null);
  const [restored, setRestored] = useState<Record<string, string | string[]> | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storageKey = key ? PREFIX + key : null;

  // Look for a waiting draft whenever the form's identity changes — a different
  // client or template is a different form, with its own draft or none.
  useEffect(() => {
    setAvailable(null);
    setRestored(null);
    setSavedAt(null);
    if (!storageKey) return;

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as StoredDraft;
      const ageHours = (Date.now() - draft.savedAt) / 3_600_000;
      if (ageHours > MAX_AGE_HOURS) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      setAvailable({ savedAt: new Date(draft.savedAt) });
    } catch {
      // Corrupt or unreadable storage is not worth a broken form.
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return {
    available,
    restored,
    savedAt,

    capture(form) {
      if (!storageKey) return;
      /*
       * Never while a draft is waiting to be answered for.
       *
       * Opening the form fires a change event before anybody has typed, and
       * without this guard that empty form was written straight over the draft
       * the page had *just* offered to restore — so "Put it back" put back
       * nothing at all. Found in a browser; the storage write and the read were
       * both correct in isolation. The offer stands until it is accepted or
       * discarded, and only then does this form start saving over it.
       */
      if (available) return;

      if (timer.current) clearTimeout(timer.current);
      /*
       * Debounced, and read off the form rather than tracked per field. A
       * write per keystroke would be a synchronous storage call on every
       * letter typed, which is the wrong thing to do on the cheap phone this
       * is designed for.
       */
      timer.current = setTimeout(() => {
        const values: Record<string, string | string[]> = {};
        const data = new FormData(form);
        for (const name of new Set(data.keys())) {
          // Never the hidden plumbing React puts in a server-action form, and
          // never a file input's contents.
          if (name.startsWith("$")) continue;
          const all = data.getAll(name).filter((v) => typeof v === "string") as string[];
          if (all.length === 0) continue;
          values[name] = all.length > 1 || multiple.has(name) ? all : all[0];
        }
        // Nothing written yet is nothing to recover, and a draft of defaults
        // would offer itself on every visit for no reason.
        if (!hasContent(values)) return;

        try {
          const now = Date.now();
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({ savedAt: now, values } satisfies StoredDraft)
          );
          setSavedAt(new Date(now));
        } catch {
          // Storage full or blocked. Losing the draft is bad; losing the form
          // to an exception while typing is worse.
        }
      }, 800);
    },

    restore() {
      if (!storageKey) return;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return;
        setRestored((JSON.parse(raw) as StoredDraft).values);
        setAvailable(null);
      } catch {
        setAvailable(null);
      }
    },

    discard() {
      if (storageKey) window.localStorage.removeItem(storageKey);
      setAvailable(null);
    },

    clear() {
      if (timer.current) clearTimeout(timer.current);
      if (storageKey) window.localStorage.removeItem(storageKey);
      setAvailable(null);
      setSavedAt(null);
    },
  };
}
