"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sealText } from "@/lib/crypto/text";
import { requireRole } from "@/lib/auth/session";
import { submitEncounter } from "@/lib/intake/submit";
import { writeAudit } from "@/lib/audit";
import { readHandwriting, readerConfigured } from "@/lib/ai/reader";
import { autoDeliverSubmission } from "@/lib/intake/autoDeliver";
import { createAdminClient, BUCKET_PAGES } from "@/lib/supabase/admin";
import { logSafe } from "@/lib/redact";
import type { Prisma } from "@prisma/client";

export interface PhotoState {
  error?: string;
  blocked?: { message: string };
  success?: {
    submissionId: string;
    pages: number;
    transcribed: number;
    /**
     * What happened after the reader ran.
     *
     * `delivered` means the note was written and sent without anybody being
     * asked to confirm anything — the behaviour this path exists for. Anything
     * else carries the reason it could not be, and the screen says which rather
     * than implying something went out. The submission is saved either way.
     */
    delivery:
      | { delivered: true; passcode: string | null; url: string; gaps: string[] }
      | { delivered: false; message: string };
  };
}

/**
 * Registers a photographed submission once the images are already in Storage.
 *
 * The bytes went straight from the phone to Supabase via a signed URL, so this
 * action only ever handles paths. That keeps clinical images out of a
 * serverless function's memory, its temp directory and its logs entirely.
 *
 * OCR is attempted here, inline, and is allowed to fail. When it does — no key,
 * a timeout, an unreadable page — the page lands in the workspace with an empty
 * transcript and gets typed by a person. That is precisely today's process, so
 * the degraded path is the baseline rather than an outage.
 */
export async function submitPhotoPages(
  _prev: PhotoState,
  formData: FormData
): Promise<PhotoState> {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  if (!user.discipline) {
    return {
      error:
        "Set your discipline before submitting — it decides what kind of note gets written from this. Go to Your discipline.",
    };
  }

  const clientId = String(formData.get("clientId") ?? "");
  const encounterDateRaw = String(formData.get("encounterDate") ?? "");
  const paths = formData.getAll("paths").map(String).filter(Boolean);
  const context = String(formData.get("context") ?? "").trim();

  if (!clientId || !encounterDateRaw) return { error: "Choose a client and the session date." };
  if (paths.length === 0) return { error: "Add at least one photograph." };
  if (paths.length > 20) return { error: "A submission can contain at most 20 pages." };
  if (new Set(paths).size !== paths.length) return { error: "The same page was submitted more than once." };

  // Upload URLs are minted under note-pages/<practiceId>/... by the server.
  // Never register a browser-supplied path from another tenant or bucket.
  const requiredPrefix = `${BUCKET_PAGES}/${user.practiceId}/`;
  if (paths.some((path) => !path.startsWith(requiredPrefix) || path.includes(".."))) {
    logSafe("photo.submit", "rejected storage path outside caller practice", { userId: user.id });
    return { error: "One or more uploaded pages are not valid for this practice." };
  }

  const encounterDate = new Date(encounterDateRaw);
  if (Number.isNaN(encounterDate.getTime())) return { error: "That session date is not valid." };

  const result = await submitEncounter({
    practiceId: user.practiceId,
    clientId,
    submittedBy: user,
    kind: "PHOTO",
    templateKind: "NARRATIVE",
    encounterDate,
    fields: {},
    extraText: context,
  });

  if (!result.ok && result.reason === "not_found") {
    return { error: "That client could not be found." };
  }
  if (!result.ok) return { blocked: { message: result.message } };

  // Record the pages first, so a crash during OCR still leaves a complete,
  // typeable submission rather than a submission with missing pages.
  await prisma.submissionPage.createMany({
    data: paths.map((storagePath, index) => ({
      submissionId: result.submissionId,
      pageNumber: index + 1,
      storagePath,
    })),
  });

  let transcribed = 0;
  if (readerConfigured()) {
    transcribed = await transcribePages(result.submissionId);
  }

  /*
   * Straight out, without stopping at the verification queue.
   *
   * The deliberate change the practice asked for: a photographed update should
   * reach the note writer immediately, with a copy back to whoever sent it,
   * rather than waiting for somebody to confirm a transcript.
   *
   * `autoDeliverSubmission` refuses rather than sends when the reader returned
   * nothing — an empty note carrying a client code is worse for the person
   * receiving it than a queue, because they cannot tell it from a quiet week.
   * In that case the submission stays exactly where a human can type it.
   */
  const outcome = await autoDeliverSubmission(result.submissionId, user);
  const delivery = outcome.ok
    ? {
        delivered: true as const,
        passcode: outcome.share.passcode,
        url: outcome.share.url,
        gaps: outcome.gaps,
      }
    : { delivered: false as const, message: outcome.message };

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "submission.pages_uploaded",
    entityType: "submission",
    entityId: result.submissionId,
    changes: { pages: { from: 0, to: paths.length } },
  });

  revalidatePath("/s");
  return {
    success: { submissionId: result.submissionId, pages: paths.length, transcribed, delivery },
  };
}

/** Reads each page and stores the transcript. Returns how many succeeded. */
async function transcribePages(submissionId: string): Promise<number> {
  const pages = await prisma.submissionPage.findMany({
    where: { submissionId, ocrTextEnc: null },
    orderBy: { pageNumber: "asc" },
  });

  let count = 0;
  for (const page of pages) {
    try {
      const dataUri = await downloadAsDataUri(page.storagePath);
      if (!dataUri) continue;

      const result = await readHandwriting(dataUri, `ocr.page.${page.id}`);
      if (!result) continue;

      await prisma.submissionPage.update({
        where: { id: page.id },
        data: {
          ocrTextEnc: sealText(result.text),
          ocrBlocks: result.blocks as unknown as Prisma.InputJsonValue,
          ocrConfidence: result.minConfidence,
          ocrProvider: result.provider,
        },
      });
      count++;
    } catch (error) {
      // One unreadable page must not cost the other five their transcripts.
      logSafe("ocr", "page failed", {
        pageId: page.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return count;
}

/**
 * Pulls a private object out of Storage as a data URI for the reader.
 *
 * Deliberately not a signed public URL handed to the model provider: a URL can
 * be fetched again later, by anyone who has it, from anywhere. Sending the bytes
 * inline means the image exists in that request and nowhere else.
 */
async function downloadAsDataUri(storagePath: string): Promise<string | null> {
  const [bucket, ...rest] = storagePath.split("/");
  const key = rest.join("/");
  if (bucket !== BUCKET_PAGES || !key) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).download(key);
  if (error || !data) return null;

  const buffer = Buffer.from(await data.arrayBuffer());
  const mime = data.type || "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}
