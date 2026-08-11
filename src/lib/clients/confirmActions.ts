"use server";

import { prisma } from "@/lib/prisma";
import { readConfirmToken } from "@/lib/auth/signedLink";
import { changeClientStatus, StatusChangeError } from "@/lib/clients/status";
import { writeAudit } from "@/lib/audit";
import type { ClientStatus } from "@prisma/client";

export interface ConfirmState {
  error?: string;
  done?: string;
}

/**
 * Answering the "is this client still active?" question from an email link.
 *
 * The token is re-verified here, server-side, on submit — the page having
 * rendered proves nothing about the request that follows it. And the answer is
 * attributed to the therapist the confirmation was addressed to, not to
 * "system", because a status change with no name against it is the kind of
 * record that cannot be defended later.
 *
 * `askedStatus` is checked against the client's current status before anything
 * is written. If somebody changed it in the meantime, a two-week-old email
 * cannot silently undo their change.
 */
export async function answerConfirmation(
  _prev: ConfirmState,
  formData: FormData
): Promise<ConfirmState> {
  const token = String(formData.get("token") ?? "");
  const answer = String(formData.get("answer") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const confirmationId = await readConfirmToken(token);
  if (!confirmationId) return { error: "This link has expired." };

  const confirmation = await prisma.statusConfirmation.findUnique({
    where: { id: confirmationId },
    include: { client: true, therapist: true },
  });
  if (!confirmation) return { error: "This request no longer exists." };
  if (confirmation.respondedAt) return { done: "Already answered — thank you." };

  if (confirmation.client.status !== confirmation.askedStatus) {
    await prisma.statusConfirmation.update({
      where: { id: confirmation.id },
      data: { respondedAt: new Date(), response: "SUPERSEDED" },
    });
    return {
      done: "Someone has already updated this client since the request was sent, so nothing was changed.",
    };
  }

  if (answer === "CONFIRMED_ACTIVE") {
    await prisma.statusConfirmation.update({
      where: { id: confirmation.id },
      data: { respondedAt: new Date(), response: "CONFIRMED_ACTIVE" },
    });
    await writeAudit({
      practiceId: confirmation.practiceId,
      actor: confirmation.therapist,
      action: "confirmation.confirmed_active",
      entityType: "client",
      entityId: confirmation.clientId,
      entityLabel: confirmation.client.clientCode,
    });
    return { done: "Recorded as still active. Thank you." };
  }

  const toStatus = answer as ClientStatus;
  if (!["ON_HOLD", "DISCHARGED", "TRANSFERRED", "DECEASED"].includes(toStatus)) {
    return { error: "Choose one of the options." };
  }
  if (!reason) return { error: "Please add a short reason — it is required for the record." };

  try {
    await changeClientStatus({
      client: confirmation.client,
      toStatus,
      reason,
      actor: confirmation.therapist,
      source: "CONFIRMATION_SWEEP",
    });
  } catch (error) {
    if (error instanceof StatusChangeError) return { error: error.message };
    throw error;
  }

  await prisma.statusConfirmation.update({
    where: { id: confirmation.id },
    data: { respondedAt: new Date(), response: toStatus },
  });

  return {
    done: "Thank you — recorded. New notes will not be produced against this client from now on.",
  };
}
