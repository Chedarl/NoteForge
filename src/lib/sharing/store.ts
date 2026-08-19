import "server-only";

import { createHash, randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { createAdminClient, BUCKET_EXPORTS } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { generatePasscode, hashPasscode, passcodeAvailable } from "@/lib/sharing/passcode";
import { logSafe } from "@/lib/redact";
import type { User } from "@prisma/client";

/**
 * Storing a PDF behind an expiring, counted link.
 *
 * One implementation for all three kinds of shareable document — a single
 * submission, a round of them, and a client list. They differ only in what
 * bytes go in and what the thing is called; the parts that must not vary are
 * the token being stored as a hash, the object key being random, the expiry,
 * the download ceiling and the audit row. Three copies of that would be three
 * chances for one of them to quietly lose a guarantee.
 *
 * Not a `"use server"` module: those may only export async *actions*, and this
 * is a helper the action files call.
 */

export type ShareDocumentKind = "submission" | "round" | "roster";

export interface StoredShare {
  token: string;
  expiresAt: Date;
  ttlHours: number;
  /**
   * The six digits, shown to the sender exactly once and never stored in
   * readable form. Null when the link is bearer-only.
   */
  passcode: string | null;
}

export function shareTtlHours(): number {
  const configured = Number(process.env.PDF_SHARE_TTL_HOURS ?? "24");
  if (!Number.isFinite(configured)) return 24;
  return Math.min(168, Math.max(1, Math.floor(configured)));
}

export async function storeSharedPdf(args: {
  user: User;
  bytes: Uint8Array;
  documentKind: ShareDocumentKind;
  /** Null for a client list, which is not about one encounter. */
  submissionId: string | null;
  /** Client codes or a count — never a name. Goes to the audit trail only. */
  auditLabel: string;
  /**
   * Whether the recipient must type a six-digit code before the PDF is
   * released. See `passcode.ts` for why this exists rather than a longer URL.
   *
   * The caller decides because the caller knows what is in the document: a
   * bundle carrying decrypted client names is a different object from one
   * identified by practice code alone.
   */
  requirePasscode?: boolean;
}): Promise<{ ok: true; share: StoredShare } | { ok: false; error: string }> {
  const { user, bytes, documentKind, submissionId, auditLabel } = args;

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  /*
   * Fail closed. A link that reports itself as protected while carrying no
   * passcode is worse than one that was never offered, because the sender
   * relaxes about where it goes.
   */
  if (args.requirePasscode && !passcodeAvailable()) {
    return {
      ok: false,
      error:
        "This deployment cannot lock a shared link with a code — CONFIRM_LINK_SECRET is not set. Download the PDF and hand it over yourself, or ask an administrator to set it.",
    };
  }
  const passcode = args.requirePasscode ? generatePasscode() : null;
  const ttlHours = shareTtlHours();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  // Random key: the object path itself must reveal nothing, since it is stored
  // and logged. The readable filename rides on the download response instead.
  const key = `${user.practiceId}/shares/${randomUUID()}.pdf`;
  const storagePath = `${BUCKET_EXPORTS}/${key}`;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    // No service key. Said plainly, because the alternative is a clinician
    // pressing a button that fails for a reason nobody can see.
    return {
      ok: false,
      error:
        "Secure sharing is not configured on this deployment — the Supabase secret key is missing. Download the PDF and send it yourself, or ask an administrator to set it.",
    };
  }

  const { error: uploadError } = await admin.storage.from(BUCKET_EXPORTS).upload(key, bytes, {
    contentType: "application/pdf",
    cacheControl: "0",
    upsert: false,
  });
  if (uploadError) {
    logSafe("share", "PDF upload failed", { documentKind, error: uploadError.message });
    return {
      ok: false,
      error:
        "The PDF could not be stored for sharing. If this deployment is new, the storage bucket may not exist yet.",
    };
  }

  let shareId: string;
  try {
    const share = await prisma.shareLink.create({
      data: {
        tokenHash,
        practiceId: user.practiceId,
        submissionId,
        documentKind,
        createdById: user.id,
        storagePath,
        expiresAt,
        passcodeHash: passcode ? hashPasscode(tokenHash, passcode) : null,
      },
    });
    shareId = share.id;
  } catch (error) {
    // Leaving an unreferenced object in the bucket would be a slow leak of
    // clinical PDFs nothing points at, so the upload is undone.
    await admin.storage.from(BUCKET_EXPORTS).remove([key]);
    logSafe("share", "share record creation failed", {
      documentKind,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "The secure link could not be created. Please try again." };
  }

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "share.created",
    entityType: "share",
    entityId: shareId,
    entityLabel: auditLabel,
    changes: {
      documentKind: { from: null, to: documentKind },
      expiresAt: { from: null, to: expiresAt.toISOString() },
      // Recorded because "was that one locked?" is the first question asked
      // about a link after the fact, and the code itself must never be here.
      passcodeProtected: { from: null, to: passcode !== null },
    },
  });

  return { ok: true, share: { token, expiresAt, ttlHours, passcode } };
}

/** The `wa.me` hand-off. A blank number makes WhatsApp offer its contact picker. */
export function whatsappHandoff(args: {
  phone: string | null;
  siteUrl: string;
  token: string;
  ttlHours: number;
  lead: string;
}): { whatsappUrl: string; downloadUrl: string } {
  const downloadUrl = `${args.siteUrl}/share/${args.token}`;
  const message = [
    args.lead,
    `The link expires in ${args.ttlHours} hours and is limited to 10 downloads.`,
    downloadUrl,
  ].join("\n\n");

  return {
    downloadUrl,
    whatsappUrl: `https://wa.me/${args.phone?.replace(/\D/g, "") ?? ""}?text=${encodeURIComponent(message)}`,
  };
}
