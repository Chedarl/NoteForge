"use server";

import { createHash, randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient, BUCKET_EXPORTS } from "@/lib/supabase/admin";
import { buildSubmissionPdf, buildBatchPdf } from "@/lib/export/submissionPdf";
import { normalizeWhatsAppNumber } from "@/lib/sharing/phone";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { siteUrl } from "@/lib/email/send";
import { writeAudit } from "@/lib/audit";
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

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const ttlHours = shareTtlHours();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  // Random path so the object key leaks nothing; the §5 filename rides on the
  // download response instead.
  const key = `${user.practiceId}/shares/${randomUUID()}.pdf`;
  const storagePath = `${BUCKET_EXPORTS}/${key}`;
  const admin = createAdminClient();

  const { error: uploadError } = await admin.storage.from(BUCKET_EXPORTS).upload(key, bytes, {
    contentType: "application/pdf",
    cacheControl: "0",
    upsert: false,
  });
  if (uploadError) {
    logSafe("share", "private PDF upload failed", { submissionId, error: uploadError.message });
    return { error: "The secure PDF could not be stored. Please try again." };
  }

  let shareId: string;
  try {
    const share = await prisma.shareLink.create({
      data: {
        tokenHash,
        practiceId: user.practiceId,
        submissionId: submission.id,
        createdById: user.id,
        storagePath,
        expiresAt,
      },
    });
    shareId = share.id;
  } catch (error) {
    await admin.storage.from(BUCKET_EXPORTS).remove([key]);
    logSafe("share", "share record creation failed", {
      submissionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "The secure link could not be created. Please try again." };
  }

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "share.created",
    entityType: "share",
    entityId: shareId,
    entityLabel: submission.client.clientCode,
    changes: { expiresAt: { from: null, to: expiresAt.toISOString() } },
  });

  const downloadUrl = `${siteUrl()}/share/${token}`;
  const message = [
    "A secure NoteForge PDF is ready for note production.",
    `The link expires in ${ttlHours} hours and is limited to 10 downloads.`,
    downloadUrl,
  ].join("\n\n");
  const digits = phone?.replace(/\D/g, "") ?? "";
  const whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;

  return {
    success: {
      whatsappUrl,
      downloadUrl,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

function shareTtlHours(): number {
  const configured = Number(process.env.PDF_SHARE_TTL_HOURS ?? "24");
  if (!Number.isFinite(configured)) return 24;
  return Math.min(168, Math.max(1, Math.floor(configured)));
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

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const ttlHours = shareTtlHours();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const key = `${user.practiceId}/shares/${randomUUID()}.pdf`;
  const storagePath = `${BUCKET_EXPORTS}/${key}`;
  const admin = createAdminClient();

  const { error: uploadError } = await admin.storage.from(BUCKET_EXPORTS).upload(key, bytes, {
    contentType: "application/pdf",
    cacheControl: "0",
    upsert: false,
  });
  if (uploadError) {
    logSafe("share", "round PDF upload failed", { error: uploadError.message });
    return { error: "The secure PDF could not be stored. Please try again." };
  }

  let shareId: string;
  try {
    const share = await prisma.shareLink.create({
      data: {
        tokenHash,
        practiceId: user.practiceId,
        // Anchored to the first submission because ShareLink belongs to one.
        // The stored object is the whole round; the anchor exists so revoking
        // and auditing still have something concrete to point at.
        submissionId: submissions[0].id,
        createdById: user.id,
        storagePath,
        expiresAt,
      },
    });
    shareId = share.id;
  } catch (error) {
    await admin.storage.from(BUCKET_EXPORTS).remove([key]);
    logSafe("share", "round share record creation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "The secure link could not be created. Please try again." };
  }

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "share.created",
    entityType: "share",
    entityId: shareId,
    entityLabel: submissions.map((s) => s.client.clientCode).join(", "),
    changes: {
      expiresAt: { from: null, to: expiresAt.toISOString() },
      clients: { from: null, to: String(submissions.length) },
    },
  });

  const downloadUrl = `${siteUrl()}/share/${token}`;
  const message = [
    submissions.length === 1
      ? "A secure NoteForge PDF is ready for note production."
      : `A secure NoteForge PDF with ${submissions.length} client updates is ready for note production.`,
    `The link expires in ${ttlHours} hours and is limited to 10 downloads.`,
    downloadUrl,
  ].join("\n\n");
  const digits = phone?.replace(/\D/g, "") ?? "";
  const whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;

  return {
    success: { whatsappUrl, downloadUrl, expiresAt: expiresAt.toISOString() },
  };
}
