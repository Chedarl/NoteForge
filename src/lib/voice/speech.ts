"use client";

/**
 * Transcribing on the worker's own phone, with no key and no account.
 *
 * ## Why this rather than a transcription API
 *
 * Every server-side option needs a provider account, and this product has spent
 * a full day proving how far a missing credential can set you back. The browser
 * already ships a speech recogniser: `SpeechRecognition` is in Chrome on
 * Android and Safari on iOS, needs no key, no card and no approval, and it runs
 * while the microphone is already open.
 *
 * That makes it the one path that cannot be blocked by a signup flow, which for
 * a worker standing in a car park at nine in the evening is the whole point.
 *
 * ## The trade, stated plainly, because it matters more here than usual
 *
 * **This is not on-device.** Chrome streams the audio to Google's speech
 * service and Safari may use Apple's. A clinician describing a client aloud is
 * therefore sending that description to a third party — and a spoken sentence
 * is far less de-identified than anything else this product handles, because
 * people say names when they talk.
 *
 * The interface says so before anybody presses record. That is not a footnote
 * to add later; a worker who did not know cannot have consented.
 *
 * ## Why at record time rather than from a file
 *
 * `SpeechRecognition` listens to a live microphone and cannot be handed a
 * recording. That reads as a limitation and is mostly a gift: the words are
 * ready the moment the speaker stops, so nothing is uploaded, nothing is
 * stored, and there is no second round trip to fail. What lands in the database
 * is text the worker has read and approved — never audio.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechResultEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}

type Ctor = new () => SpeechRecognitionLike;

function constructor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can do it at all — checked before anything is offered. */
export function speechSupported(): boolean {
  return constructor() !== null;
}

export interface Dictation {
  stop(): void;
}

/**
 * Starts listening, handing each settled phrase to `onPhrase`.
 *
 * **Never throws.** An unsupported browser, a refused microphone, or a
 * recogniser that dies mid-sentence all end the same way: no words, and a
 * worker who types instead. Dictation is a convenience on top of a box that
 * already works, and it must never be able to cost somebody their update.
 */
export function startDictation(handlers: {
  onPhrase: (text: string) => void;
  onError: (reason: string) => void;
  onEnd: () => void;
}): Dictation {
  const Ctor = constructor();
  if (!Ctor) {
    handlers.onError("This browser cannot listen. Type the update instead.");
    return { stop: () => {} };
  }

  let live: SpeechRecognitionLike | null = null;

  try {
    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-US";
    // An update is one continuous thought with pauses in it. Without this the
    // recogniser stops at the first silence and loses everything after it.
    recognition.continuous = true;
    // Settled text only. Interim results flicker and rewrite themselves, and
    // half a rewritten phrase landing in a clinical record is worse than none.
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) handlers.onPhrase(result[0].transcript.trim());
      }
    };

    recognition.onerror = (event) => {
      handlers.onError(
        event?.error === "not-allowed"
          ? "The microphone was blocked. Allow it in your browser, or type the update."
          : "Dictation stopped. Type the rest, or start it again."
      );
    };

    recognition.onend = handlers.onEnd;

    recognition.start();
    live = recognition;
  } catch {
    // Some browsers throw on start() when the microphone is already claimed.
    handlers.onError("The microphone is busy. Close other apps using it, or type the update.");
    live = null;
  }

  return {
    stop: () => {
      try {
        live?.stop();
      } catch {
        /* already stopped, or never started */
      }
    },
  };
}
