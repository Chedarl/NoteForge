import "server-only";

import { prisma } from "@/lib/prisma";
import { sealText } from "@/lib/crypto/text";
import { openText } from "@/lib/crypto/text";
import { writeAudit } from "@/lib/audit";
import { sendMail, siteUrl } from "@/lib/email/send";
import { STATUS_LABEL } from "@/lib/clients/labels";
import type { Client, ClientStatus, User } from "@prisma/client";

/**
 * Changing a client's status — the one write in this system that has to be
 * loud.
 *
 * Everything happens together or not at all: the client row moves, an
 * append-only `ClientStatusEvent` records who and why, an audit row records the
 * same for the compliance trail, and the people affected are told. The
 * transaction covers the first three; email is deliberately outside it, because
 * a Resend outage must not roll back the fact that somebody died.
 *
 * A reason is required for every non-ACTIVE status. "Discharged, no reason
 * given" is the record that cannot be defended six months later when somebody
 * asks why notes stopped.
 */

export interface StatusChangeInput {
  client: Client;
  toStatus: ClientStatus;
  reason: string | null;
  actor: User | null;
  /** THERAPIST_UPDATE | CONFIRMATION_SWEEP | ADMIN | SEED */
  source: string;
}

export class StatusChangeError extends Error {}

export async function changeClientStatus(input: StatusChangeInput): Promise<Client> {
  const { client, toStatus, reason, actor, source } = input;

  if (client.status === toStatus) return client;
  if (toStatus !== "ACTIVE" && !reason?.trim()) {
    throw new StatusChangeError(`A reason is required when marking a client ${STATUS_LABEL[toStatus]}.`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.client.update({
      where: { id: client.id },
      data: {
        status: toStatus,
        statusReasonEnc: reason?.trim() ? sealText(reason.trim()) : null,
        statusChangedAt: new Date(),
        statusChangedById: actor?.id ?? null,
      },
    });

    await tx.clientStatusEvent.create({
      data: {
        clientId: client.id,
        fromStatus: client.status,
        toStatus,
        reasonEnc: reason?.trim() ? sealText(reason.trim()) : null,
        source,
        changedById: actor?.id ?? null,
      },
    });

    return next;
  });

  await writeAudit({
    practiceId: client.practiceId,
    actor,
    action: "client.status_changed",
    entityType: "client",
    entityId: client.id,
    entityLabel: client.clientCode,
    changes: { status: { from: client.status, to: toStatus } },
  });

  await notifyStatusChange(updated, client.status, actor);

  return updated;
}

/**
 * Tells the people who need to know, now rather than when they next log in.
 *
 * The message carries a client code and a status and nothing else. No name — we
 * do not hold one — and no clinical detail, because this lands in an ordinary
 * inbox.
 */
async function notifyStatusChange(
  client: Client,
  fromStatus: ClientStatus,
  actor: User | null
): Promise<void> {
  const recipients = await prisma.user.findMany({
    where: {
      practiceId: client.practiceId,
      status: "ACTIVE",
      OR: [
        { role: { in: ["OWNER", "SPECIALIST"] } },
        ...(client.primaryTherapistId ? [{ id: client.primaryTherapistId }] : []),
      ],
    },
    select: { email: true },
  });
  // Field agents have no email address; they are told nothing by mail and that
  // is correct — they submit through a link and see only the form.
  const addresses = recipients.map((r) => r.email).filter((e): e is string => Boolean(e));
  if (addresses.length === 0) return;

  await sendMail({
    to: addresses,
    subject: `NoteForge — ${client.clientCode} is now ${STATUS_LABEL[client.status]}`,
    text: [
      `Client ${client.clientCode} changed from ${STATUS_LABEL[fromStatus]} to ${STATUS_LABEL[client.status]}.`,
      openText(client.statusReasonEnc) ? `Reason given: ${openText(client.statusReasonEnc)}` : null,
      actor ? `Changed by ${actor.fullName}.` : "Changed by the system.",
      "",
      client.status === "ACTIVE"
        ? "New notes are accepted for this client again."
        : "New notes will be refused for this client until the status changes.",
      "",
      `${siteUrl()}/s/clients/${client.id}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export { STATUS_OPTIONS } from "@/lib/clients/labels";
