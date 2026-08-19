"use server";

import { createHash } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/security/rateLimit";
import {
  MAX_PASSCODE_ATTEMPTS,
  UNLOCK_MINUTES,
  passcodeMatches,
  unlockCookieName,
  unlockValue,
} from "@/lib/sharing/passcode";

/**
 * Answering the code question on a locked share link.
 *
 * Unauthenticated by design — the person holding the link has no account, which
 * is the entire point of a share link — so everything that would normally be
 * done by `requireRole` is done by hand here:
 *
 *  - the token is validated by shape before it is used to look anything up;
 *  - the attempt counter is incremented **in the same statement** that reads
 *    the row, so two tabs guessing at once cannot each get five tries;
 *  - a wrong answer says only "that is not the code", never whether the link
 *    exists, has expired, or was already locked. A message that distinguishes
 *    those is a way to enumerate links;
 *  - the failure is written to the audit trail, because somebody guessing at a
 *    clinical document is exactly what a practice needs to be able to see.
 */

export interface UnlockState {
  error?: string;
  /** Set when the ceiling has been reached and the link is finished. */
  locked?: boolean;
}

export async function unlockShare(
  _prev: UnlockState,
  formData: FormData
): Promise<UnlockState> {
  const token = String(formData.get("token") ?? "");
  const supplied = String(formData.get("passcode") ?? "").replace(/\D/g, "");

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { error: "That is not the code." };

  /*
   * Rate limited on the token as well as by the attempt ceiling. The ceiling
   * stops guessing at one link; this stops a script working through many links
   * quickly enough to matter, and it costs a legitimate recipient nothing —
   * nobody types a six-digit code twenty times a minute.
   */
  const limit = checkRateLimit(`share-unlock:${token}`, 20, 60);
  if (!limit.ok) {
    return { error: "Too many attempts just now. Wait a minute and try again." };
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  /*
   * Read and increment together. Doing it as a read, a compare and then an
   * update would let two requests both read "4 attempts used" and both proceed,
   * which turns a five-guess ceiling into as many as the attacker has parallel
   * connections.
   */
  const rows = await prisma.$queryRaw<
    { id: string; practiceId: string; passcodeHash: string | null; attempts: number; locked: Date | null }[]
  >`
    UPDATE "ShareLink"
    SET "passcodeAttempts" = "passcodeAttempts" + 1
    WHERE "tokenHash" = ${tokenHash}
      AND "revokedAt" IS NULL
      AND "expiresAt" > CURRENT_TIMESTAMP
      AND "passcodeLockedAt" IS NULL
    RETURNING "id", "practiceId", "passcodeHash", "passcodeAttempts" AS "attempts", "passcodeLockedAt" AS "locked"
  `;

  const share = rows[0];
  // Absent, expired, withdrawn or already locked all look identical from here.
  if (!share || !share.passcodeHash) return { error: "That is not the code." };

  if (passcodeMatches(tokenHash, share.passcodeHash, supplied)) {
    // Reset on success, so an honest recipient who fat-fingered it twice does
    // not carry those attempts around for the life of the link.
    await prisma.shareLink.update({
      where: { id: share.id },
      data: { passcodeAttempts: 0 },
    });

    const jar = await cookies();
    jar.set(unlockCookieName(tokenHash), unlockValue(tokenHash), {
      httpOnly: true,
      sameSite: "lax",
      // Scoped to this one link, so unlocking one share cannot release another
      // that happens to be open in the same browser.
      path: `/share/${token}`,
      maxAge: UNLOCK_MINUTES * 60,
      secure: process.env.NODE_ENV === "production",
    });

    await writeAudit({
      practiceId: share.practiceId,
      actor: null,
      action: "share.unlocked",
      entityType: "share",
      entityId: share.id,
      entityLabel: "recipient entered the code",
    });

    return {};
  }

  const exhausted = share.attempts >= MAX_PASSCODE_ATTEMPTS;
  if (exhausted) {
    await prisma.shareLink.update({
      where: { id: share.id },
      data: { passcodeLockedAt: new Date() },
    });
  }

  await writeAudit({
    practiceId: share.practiceId,
    actor: null,
    action: exhausted ? "share.locked" : "share.unlock_failed",
    entityType: "share",
    entityId: share.id,
    entityLabel: `attempt ${share.attempts} of ${MAX_PASSCODE_ATTEMPTS}`,
  });

  if (exhausted) {
    return {
      locked: true,
      error:
        "Too many wrong codes. This link is now closed — ask whoever sent it for a new one.",
    };
  }

  const left = MAX_PASSCODE_ATTEMPTS - share.attempts;
  return {
    error: `That is not the code. ${left} attempt${left === 1 ? "" : "s"} left before the link closes.`,
  };
}
