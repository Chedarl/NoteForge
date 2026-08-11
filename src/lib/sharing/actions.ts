"use server";

import { createHash, randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient, BUCKET_EXPORTS } from "@/lib/supabase/admin";
import { renderSubmissionPdf } from "@/lib/sharing/pdf";
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

  let bytes: Uint8Array;
  try {
    bytes = await renderSubmissionPdf({
      practiceName: submission.practice.name,
      clientCode: submission.client.clientCode,
      clientInitials: submission.client.initials,
      birthYear: submission.client.birthYear,
      submittedBy: submission.submittedBy.fullName,
      encounterDate: submission.encounterDate,
      createdAt: submission.createdAt,
      kind: submission.kind,
      templateKind: submission.templateKind,
      discipline: submission.discipline,
      fields:
        submission.fields && typeof submission.fields === "object" && !Array.isArray(submission.fields)
          ? (submission.fields as Record<string, unknown>)
          : {},
      rawText: submission.rawText,
      pages: submission.pages,
    });
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
