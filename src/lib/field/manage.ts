"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createFieldAgent, revokeFieldLink } from "@/lib/field/links";
import { siteUrl } from "@/lib/email/send";
import { writeAudit } from "@/lib/audit";
import { DISCIPLINE_OPTIONS } from "@/lib/intake/disciplines";
import type { Discipline } from "@prisma/client";

export interface AgentState {
  error?: string;
  /** Shown once and never retrievable again. */
  created?: { name: string; url: string };
  revoked?: boolean;
}

/**
 * Creates a field agent and hands back their link exactly once.
 *
 * The plaintext token exists only in this return value. Nothing stores it,
 * nothing can show it again, and a lost link is replaced rather than recovered
 * — the same discipline any credential deserves, and the reason the screen says
 * so before the owner navigates away.
 */
export async function addFieldAgent(
  _prev: AgentState,
  formData: FormData
): Promise<AgentState> {
  /*
   * Any clinician, not only an owner.
   *
   * The point of the link is that the nurse who works with a client hands it to
   * the case worker who visits them, and reads what comes back. Routing that
   * through an administrator puts a person with no clinical relationship
   * between the two, and makes the nurse wait on somebody else to onboard her
   * own worker.
   */
  const user = await requireRole(["OWNER", "THERAPIST", "SPECIALIST"]);

  const fullName = String(formData.get("fullName") ?? "").trim();
  const discipline = String(formData.get("discipline") ?? "") as Discipline;

  if (fullName.length < 2) return { error: "Give the worker a name you will recognise." };
  if (fullName.length > 80) return { error: "That name is too long." };
  if (!DISCIPLINE_OPTIONS.includes(discipline)) {
    return { error: "Choose what kind of worker this is." };
  }

  const minted = await createFieldAgent({
    practiceId: user.practiceId,
    fullName,
    discipline,
    createdById: user.id,
    // Whoever hands out the link is answerable for what arrives through it.
    supervisorId: user.id,
  });

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "field.agent.created",
    entityType: "user",
    entityId: minted.agentId,
    entityLabel: fullName,
  });

  revalidatePath("/s/settings");
  revalidatePath("/t/team");
  return { created: { name: fullName, url: `${siteUrl()}/f/${minted.token}` } };
}

export async function withdrawFieldLink(
  _prev: AgentState,
  formData: FormData
): Promise<AgentState> {
  const user = await requireRole(["OWNER", "THERAPIST", "SPECIALIST"]);
  const linkId = String(formData.get("linkId") ?? "");

  const ok = await revokeFieldLink(linkId, user.practiceId);
  if (!ok) return { error: "That link was already withdrawn." };

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "field.link.revoked",
    entityType: "fieldLink",
    entityId: linkId,
  });

  revalidatePath("/s/settings");
  revalidatePath("/t/team");
  return { revoked: true };
}

/** Everything the settings screen shows. Never includes a token. */
/**
 * The links this person is answerable for.
 *
 * An owner sees the practice's; everyone else sees the ones they supervise. A
 * nurse looking at a list of another nurse's workers cannot act on any of them
 * and would only be reading names she has no relationship with.
 */
export async function listFieldAgents(practiceId: string, supervisorId?: string) {
  return prisma.fieldLink.findMany({
    where: { practiceId, ...(supervisorId ? { supervisorId } : {}) },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    include: {
      agent: { select: { fullName: true, discipline: true, status: true } },
      supervisor: { select: { fullName: true } },
    },
  });
}
