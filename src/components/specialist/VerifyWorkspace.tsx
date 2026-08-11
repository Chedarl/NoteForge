"use client";

import { useActionState, useState } from "react";
import { saveVerification, type VerifyState } from "@/lib/workspace/actions";
import { CONFIDENCE_GATE, CONFIDENCE_POOR } from "@/lib/ai/confidence";

interface PageView {
  id: string;
  pageNumber: number;
  imageUrl: string;
  ocrText: string | null;
  ocrConfidence: number | null;
  ocrProvider: string | null;
  blocks: { text: string; confidence: number }[] | null;
  verifiedText: string | null;
}

/**
 * The original beside the transcript, one page at a time.
 *
 * ## Why side by side and not a correction queue
 *
 * The alternative design — show only the blocks the machine flagged — is faster
 * and is wrong. OCR is confidently wrong often enough that the errors it does
 * not flag are the dangerous ones, and a transcriber who never sees the page
 * has no way to catch them. So the image is always there, at full size, and the
 * confidence shading directs attention rather than replacing it.
 *
 * ## The shading
 *
 * Three bands, not a gradient. A person scanning a page needs "read this
 * carefully" and "this is probably fine"; a continuous heat map gives them a
 * decision to make about every paragraph, which is more work rather than less.
 *
 * ## The empty case is not an error
 *
 * With no OCR configured, or when the reader fails, the box is empty and the
 * page is typed by hand — which is exactly what happens today without this
 * product. The screen says so plainly instead of showing an error, because it
 * is not one.
 */
export default function VerifyWorkspace({
  submissionId,
  pages,
}: {
  submissionId: string;
  pages: PageView[];
}) {
  const [index, setIndex] = useState(0);
  const [state, formAction, pending] = useActionState<VerifyState, FormData>(
    saveVerification,
    {}
  );

  const page = pages[index];
  if (!page) {
    return (
      <p className="text-sm text-slate-600">
        This submission has no pages attached. Send it back to the therapist.
      </p>
    );
  }

  const lowConfidence =
    page.ocrConfidence !== null && page.ocrConfidence < CONFIDENCE_GATE;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="submissionId" value={submissionId} />

      {pages.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setIndex(i)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                i === index
                  ? "bg-slate-900 text-white"
                  : "border border-slate-300 text-slate-700"
              }`}
            >
              Page {p.pageNumber}
              {p.verifiedText ? " ✓" : ""}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── The original ──────────────────────────────────────────────── */}
        <div className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Original — page {page.pageNumber}
            </span>
            <a
              href={page.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sky-700 underline"
            >
              Open full size
            </a>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={page.imageUrl}
            alt={`Original page ${page.pageNumber}`}
            className="max-h-[70vh] w-full rounded object-contain"
          />
        </div>

        {/* ── The transcript ────────────────────────────────────────────── */}
        <div className="space-y-3">
          {page.ocrText ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Machine reading
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    lowConfidence ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  lowest confidence {Math.round((page.ocrConfidence ?? 0) * 100)}%
                </span>
                {page.ocrProvider ? (
                  <span className="text-xs text-slate-400">{page.ocrProvider}</span>
                ) : null}
              </div>

              {page.blocks ? (
                <div className="space-y-1.5">
                  {page.blocks.map((block, i) => (
                    <p
                      key={i}
                      className={`prose-note rounded-r px-2 py-1 text-sm ${
                        block.confidence < CONFIDENCE_POOR
                          ? "ocr-low"
                          : block.confidence < CONFIDENCE_GATE
                            ? "ocr-mid"
                            : "ocr-high"
                      }`}
                    >
                      {block.text}
                      <span className="ml-2 align-middle text-[10px] text-slate-500">
                        {Math.round(block.confidence * 100)}%
                      </span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="prose-note text-sm">{page.ocrText}</p>
              )}

              {lowConfidence ? (
                <p className="mt-2 text-xs text-amber-800">
                  Parts of this page were hard to read. Check the shaded blocks against the
                  original before you accept them — [?] marks a word the reader could not
                  make out and deliberately did not guess.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600">
              No machine transcript for this page. Type what the original says — this is the
              normal path when automatic reading is not configured or the page defeated it.
            </div>
          )}

          <div>
            <label
              htmlFor={`page_${page.id}`}
              className="block text-xs font-medium tracking-wide text-slate-500 uppercase"
            >
              Confirmed transcript — page {page.pageNumber}
            </label>
            <textarea
              id={`page_${page.id}`}
              name={`page_${page.id}`}
              rows={16}
              defaultValue={page.verifiedText ?? page.ocrText ?? ""}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm leading-relaxed"
            />
            <p className="mt-1 text-xs text-slate-500">
              This is what the note is written from. Keep the clinician&apos;s wording; write
              [illegible] rather than guessing.
            </p>
          </div>
        </div>
      </div>

      {/* Hidden fields keep every other page's text in the submission, so
          switching pages never silently drops what was already typed. */}
      {pages.map((p, i) =>
        i === index ? null : (
          <input
            key={p.id}
            type="hidden"
            name={`page_${p.id}`}
            value={p.verifiedText ?? p.ocrText ?? ""}
          />
        )
      )}

      {state.error ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Confirm transcript and continue"}
        </button>
        <span className="text-xs text-slate-500">
          Duplicate detection runs on the confirmed text, not the machine reading.
        </span>
      </div>
    </form>
  );
}
