"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

/**
 * Dictation into a textarea, using the browser's own speech recognition.
 *
 * The reason this exists is adoption. A clinician between sessions is choosing
 * between typing four paragraphs and scribbling on paper they will photograph
 * later, and the second one wins every time unless the first is genuinely
 * quick. Dictation is the difference.
 *
 * The reason it uses the *browser's* recogniser rather than a transcription API
 * is that it costs nothing, needs no key, and — in Chrome on desktop and Safari
 * — the audio is handled by the platform rather than being uploaded by us. We
 * do not want to be in the business of shipping a recording of a clinician
 * describing a session to a third party we have no agreement with.
 *
 * It is unavailable in some browsers, notably Firefox. That is fine: the button
 * simply does not render and the textarea works exactly as it always did.
 */

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function Dictate({ targetId }: { targetId: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => recognitionRef.current?.stop();
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const Ctor = recognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    // Interim results are off deliberately. Watching words appear and rewrite
    // themselves mid-sentence is distracting when what you are dictating is a
    // clinical account and accuracy matters more than the live effect.
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-GB";

    recognition.onresult = (event) => {
      const target = document.getElementById(targetId) as HTMLTextAreaElement | null;
      if (!target) return;
      let addition = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) addition += event.results[i][0].transcript;
      }
      if (!addition.trim()) return;
      const existing = target.value;
      target.value = existing ? `${existing.replace(/\s*$/, "")} ${addition.trim()}` : addition.trim();
      // React does not see a direct value assignment; tell it explicitly.
      target.dispatchEvent(new Event("input", { bubbles: true }));
    };

    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
        listening ? "bg-rose-600 text-white" : "border border-slate-300 text-slate-600"
      }`}
    >
      {listening ? <MicOff size={12} /> : <Mic size={12} />}
      {listening ? "Stop" : "Dictate"}
    </button>
  );
}
