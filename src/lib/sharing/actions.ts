"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { buildSubmissionPdf, buildBatchPdf } from "@/lib/export/submissionPdf";
import { normalizeWhatsAppNumber } from "@/lib/sharing/phone";
import { storeSharedPdf, whatsappHandoff } from "@/lib/sharing/store";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { siteUrl } from "@/lib/email/send";
import { logSafe } from "@/lib/redact";

export interface ShareState {
  error?: string;
  success?: {
    whatsappUrl: string;
    downloadUrl: string;
    expiresAt: string;
  };
}

export async function createWhatsAppShare(
  _prev: ShareState,
  formData: FormData
): Promise<ShareState> {
  const user = await requireRole(["THERAPIST", "OWNER", "SPECIALIST"]);
  const submissionId = String(formData.get("submissionId") ?? "");
  const acknowledged = formData.get("acknowledged") === "yes";
  if (!submissionId || !acknowledged) {
    return { error: "Confirm that you understand this creates a sensitive, expiring link." };
  }

  const limit = checkRateLimit(`share:${user.id}`, 10, 3600);
  if (!limit.ok) {
    return { error: `Too many share links. Try again in ${limit.retryAfterSeconds} seconds.` };
  }

  const submission = await prisma.submission.findFirst({
    where: {
      id: submissionId,
      practiceId: user.practiceId,
      state: { notIn: ["BLOCKED", "SUPERSEDED"] },
      ...(user.role === "THERAPIST" ? { submittedById: user.id } : {}),
    },
    include: {
      practice: { select: { name: true, noteWriterWhatsApp: true } },
      client: { select: { clientCode: true, initials: true, birthYear: true } },
      submittedBy: { select: { fullName: true } },
      pages: {
        orderBy: { pageNumber: "asc" },
        select: { pageNumber: true, verifiedText: true, ocrText: true },
      },
    },
  });
  if (!submission) return { error: "That submission is not available to share." };

  const rawPhone = String(formData.get("phone") ?? "");
  const phone = rawPhone.trim()
    ? normalizeWhatsAppNumber(rawPhone)
    : submission.practice.noteWriterWhatsApp;
  if (rawPhone.trim() && !phone) {
    return { error: "Enter a WhatsApp number with its country code, or leave it blank." };
  }

  /*
   * One PDF generator, not two.
   *
   * This used to assemble its own data and call a separate renderer. Both the
   * share link and the direct download now go through `buildSubmissionPdf`, so
   * the document a note writer opens is byte-for-byte the same whichever way it
   * reached them — and the §5 requirements (per-page footer, the changes-since-
   * last-submission block, the embedded JSON) hold on both paths rather than
   * only the one somebody remembered to update.
   *
   * Names stay off here. A share link travels further than a download does.
   */
  let bytes: Uint8Array;
  try {
    const built = await buildSubmissionPdf({
      submissionId: submission.id,
      practiceId: user.practiceId,
      includeName: false,
    });
    if (!built) return { error: "That submission is not available to share." };
    bytes = new Uint8Array(built.pdf);
  } catch (error) {
    logSafe("share", "PDF generation failed", {
      submissionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "The PDF could not be prepared. Please try again." };
  }

  /*
   * Stored through `storeSharedPdf` rather than here.
   *
   * This used to keep its own copy of the whole procedure — token, hash, random
   * key, upload, ShareLink row, compensating delete, audit entry — and the copy
   * drifted. Its failure messages were the generic "Please try again", which is
   * advice that cannot work for either of the two things that actually go wrong
   * on a fresh deployment: no Supabase secret key, and no `note-exports` bucket.
   * Both are permanent until somebody changes the deployment, and the shared
   * helper says so by name.
   */
  const stored = await storeSharedPdf({
    user,
    bytes,
    documentKind: "submission",
    submissionId: submission.id,
    auditLabel: submission.client.clientCode,
  });
  if (!stored.ok) return { error: stored.error };

  const { whatsappUrl, downloadUrl } = whatsappHandoff({
    phone,
    siteUrl: siteUrl(),
    token: stored.share.token,
    ttlHours: stored.share.ttlHours,
    lead: "A secure NoteForge PDF is ready for note production.",
  });

  return {
    success: { whatsappUrl, downloadUrl, expiresAt: stored.share.expiresAt.toISOString() },
  };
}

/**
 * A whole round as one shareable PDF, put into WhatsApp.
 *
 * This exists because the Cloud API path could not be used. Attaching a file to
 * a WhatsApp message needs Meta's Business Cloud API — a business account, a
 * verified sending number and an approval process measured in days — and until
 * all of that is in place `whatsappConfigured()` is false and the send simply
 * does not happen. The write screen hid its entire WhatsApp section in that
 * case, so a clinician saw no button at all and had no way to send anything.
 *
 * `wa.me` needs none of it. It opens the clinician's own WhatsApp with the
 * message composed, and they press send. The document travels as an expiring
 * link rather than an attachment, which is the trade: the file stays in the
 * system behind a token that expires and counts downloads, instead of living in
 * a chat history forever. That is strictly better for patient material, and it
 * is the option that works today.
 */
export async function createRoundWhatsAppShare(
  _prev: ShareState,
  formData: FormData
): Promise<ShareState> {
  const user = await requireRole(["THERAPIST", "OWNER", "SPECIALIST"]);

  const submissionIds = String(formData.get("submissionIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (submissionIds.length === 0) return { error: "There is nothing to share." };

  // Checked here as well as in the form. `required` on an input is a courtesy
  // to the person filling it in, not a control — this is the moment clinical
  // material becomes reachable by anyone holding a URL.
  if (formData.get("acknowledged") !== "yes") {
    return { error: "Confirm that you understand this creates a sensitive, expiring link." };
  }

  const limit = checkRateLimit(`share:${user.id}`, 10, 3600);
  if (!limit.ok) {
    return { error: `Too many share links. Try again in ${limit.retryAfterSeconds} seconds.` };
  }

  // Scoped exactly as the single-submission share is: a therapist may only
  // share what they recorded, and an id from another practice is a not-found.
  const submissions = await prisma.submission.findMany({
    where: {
      id: { in: submissionIds },
      practiceId: user.practiceId,
      state: { notIn: ["BLOCKED", "SUPERSEDED"] },
      ...(user.role === "THERAPIST" ? { submittedById: user.id } : {}),
    },
    select: { id: true, client: { select: { clientCode: true } } },
  });
  if (submissions.length === 0) return { error: "Those updates are not available to share." };

  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = rawPhone ? normalizeWhatsAppNumber(rawPhone) : null;
  if (rawPhone && !phone) {
    return { error: "Enter a WhatsApp number with its country code, or leave it blank." };
  }

  let bytes: Uint8Array;
  try {
    const built =
      submissions.length === 1
        ? await buildSubmissionPdf({
            submissionId: submissions[0].id,
            practiceId: user.practiceId,
            includeName: false,
          })
        : await buildBatchPdf({
            submissionIds: submissions.map((s) => s.id),
            practiceId: user.practiceId,
            includeName: false,
          });
    if (!built) return { error: "Those updates are not available to share." };
    bytes = new Uint8Array(built.pdf);
  } catch (error) {
    logSafe("share", "round PDF generation failed", {
      count: submissions.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "The PDF could not be prepared. Please try again." };
  }

  const stored = await storeSharedPdf({
    user,
    bytes,
    documentKind: submissions.length === 1 ? "submission" : "round",
    // Anchored to the first submission because a round has no single one of its
    // own. The stored object is the whole round; the anchor exists so revoking
    // and auditing have something concrete to point at.
    submissionId: submissions[0].id,
    auditLabel: submissions.map((s) => s.client.clientCode).join(", "),
  });
  if (!stored.ok) return { error: stored.error };

  const { whatsappUrl, downloadUrl } = whatsappHandoff({
    phone,
    siteUrl: siteUrl(),
    token: stored.share.token,
    ttlHours: stored.share.ttlHours,
    lead:
      submissions.length === 1
        ? "A secure NoteForge PDF is ready for note production."
        : `A secure NoteForge PDF with ${submissions.length} client updates is ready for note production.`,
  });

  return {
    success: { whatsappUrl, downloadUrl, expiresAt: stored.share.expiresAt.toISOString() },
  };
}
