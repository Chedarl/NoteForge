import "server-only";

import { prisma } from "@/lib/prisma";
import { logSafe } from "@/lib/redact";
import type { Prisma, User } from "@prisma/client";

/**
 * Append-only record of who did what — and, unusually, who *read* what.
 *
 * Most audit logs cover writes. In a system holding clinical material the
 * question asked far more often is "who opened this person's file", and a log
 * that only records edits cannot answer it. So `page.viewed` and
 * `insights.exported` are logged with the same weight as `note.signed`.
 *
 * Three rules:
 *
 *  - **Append-only.** Nothing in this codebase updates or deletes an AuditLog
 *    row. There is no function here that could.
 *  - **A row outlives its subject.** actorName, actorRole and entityLabel are
 *    copied at write time, so a deleted user or client is still accountable.
 *  - **Logging never breaks the thing it describes.** A failed audit write is
 *    swallowed and reported to the server log; it does not 500 a therapist
 *    mid-submission. The trade is deliberate and it is the standard one: an
 *    incomplete log is bad, a clinician who cannot file their notes is worse.
 *
 * And one thing this log never contains: note text. `changes` records which
 * fields moved and between which *statuses*, never the words in them.
 */

export type AuditEntityType =
  | "client"
  | "submission"
  | "page"
  | "note"
  | "flag"
  | "user"
  | "practice"
  | "share"
  | "insights"
  | "confirmation";

export interface AuditEntry {
  practiceId: string;
  actor: Pick<User, "id" | "fullName" | "role"> | null;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  entityLabel?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        practiceId: entry.practiceId,
        actorId: entry.actor?.id ?? null,
        actorName: entry.actor?.fullName ?? "system",
        actorRole: entry.actor?.role ?? "SYSTEM",
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityLabel: entry.entityLabel ?? null,
        changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    logSafe("audit", `failed to write ${entry.action}`, {
      entityType: entry.entityType,
      entityId: entry.entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}