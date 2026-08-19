"use client";

import { usePathname } from "next/navigation";

/**
 * The nudge for somebody who has not said what they do.
 *
 * Rendered by the portal layout, so it follows a person around every screen —
 * which is right, because nothing they can file will be accepted until it is
 * answered. The one place it must not appear is `/t`, which now asks the
 * question outright: a banner telling you to set your discipline, sitting
 * directly on top of the form setting your discipline, reads as a bug.
 *
 * A client component purely to get the pathname. A layout cannot see it, and
 * plumbing one through a header in middleware would be a lot of machinery for
 * one conditional.
 */
export default function DisciplineBanner() {
  const pathname = usePathname();
  if (pathname === "/t") return null;

  return (
    <div className="border-b border-amber-300 bg-amber-50">
      <div className="mx-auto max-w-6xl px-4 py-2 text-sm text-amber-900">
        Tell us whether you are a Social Case Worker, Nurse Practitioner or something
        else before filing notes —{" "}
        <a href="/t" className="font-medium underline">
          answer that here
        </a>
        . It decides which template you get, what kind of note is written from your
        submissions, and how this portal is laid out.
      </div>
    </div>
  );
}
