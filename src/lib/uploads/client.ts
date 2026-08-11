"use client";

import { downscaleImage } from "@/lib/uploads/downscale";

/**
 * Uploads a photographed page straight to Supabase Storage using a short-lived
 * signed URL minted by `/api/upload`.
 *
 * The bytes never pass through the Next.js server, which is what keeps a
 * multi-page photo set from becoming a serverless function's memory problem —
 * and, more to the point here, keeps clinical images out of a function's logs
 * and temporary storage entirely.
 *
 * Returns the stored path (`bucket/key`), which is what gets persisted. Never a
 * URL: the bucket is private on purpose and every read goes through the
 * role-gated media route.
 */
export async function uploadPage(file: File, submissionRef: string): Promise<string> {
  const prepared = await downscaleImage(file);

  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: prepared.name,
      contentType: prepared.type,
      submissionRef,
    }),
  });

  const payload = (await res.json()) as { signedUrl?: string; path?: string; error?: string };
  if (!res.ok || !payload.signedUrl || !payload.path) {
    throw new Error(payload.error ?? "Could not start the upload.");
  }

  const put = await fetch(payload.signedUrl, {
    method: "PUT",
    body: prepared,
    headers: { "Content-Type": prepared.type },
  });
  if (!put.ok) throw new Error("The upload did not complete. Check your connection and retry.");

  return payload.path;
}
