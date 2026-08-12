"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * What a person sees when a page throws.
 *
 * Next.js's default is "Application error: a server-side exception has
 * occurred", which tells a clinician nothing and tells whoever has to fix it
 * almost nothing either — the digest is the only way to find the real error in
 * the platform's logs, and the default buries it.
 *
 * So: say plainly that the work is safe, show the digest big enough to read off
 * a phone screen, and give a way out. **No error message or stack is rendered.**
 * A server error in this application can carry a query, a client code or a
 * fragment of a note, and none of that belongs on a screen somebody might be
 * holding in front of a client.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The message goes to the browser console for whoever is debugging, and
    // never into the page.
    console.error("NoteForge page error", error.digest ?? "");
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        This screen could not load
      </h1>
      <p className="mt-3 text-[0.95rem] leading-relaxed text-slate-600">
        Something on the server failed while building this page. Anything you had already
        saved is safe — this did not affect stored updates.
      </p>

      {error.digest && (
        <div className="mt-5 rounded-[var(--nf-radius)] border border-[color:var(--nf-border)] bg-white px-4 py-3">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Reference
          </p>
          <p className="mt-1 font-mono text-sm break-all text-slate-900">{error.digest}</p>
          <p className="nf-hint">
            Quote this when reporting it — it identifies the exact error in the server logs.
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2.5">
        <button onClick={reset} className="nf-btn nf-btn-primary">
          Try again
        </button>
        <Link href="/t/write" className="nf-btn nf-btn-quiet">
          Write an update
        </Link>
        <Link href="/login" className="nf-btn nf-btn-quiet">
          Sign in again
        </Link>
      </div>

      <p className="mt-8 text-xs text-slate-400">
        If this keeps happening, check <code>/api/health</code> — it reports which parts of
        the deployment are configured.
      </p>
    </main>
  );
}
