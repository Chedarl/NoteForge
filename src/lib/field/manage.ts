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

/**
 * Issues a worker a fresh link, retiring the one they had.
 *
 * ## Why this exists
 *
 * The token is stored only as a SHA-256 hash, so the link genuinely can be
 * shown exactly once — that part is right and is not changing. What was wrong
 * was the consequence: a clinician who created a worker on Monday and came back
 * on Tuesday to actually send it had no way to. The list showed the worker's
 * name, their status and a Withdraw button, and nothing else. Withdraw-then-add
 * did work, but it left a second worker record with the same person's name in
 * it, so the roster slowly filled with duplicates of people who had simply
 * never been sent their link.
 *
 * ## Why it replaces rather than reveals
 *
 * Because revealing is impossible, and pretending otherwise would mean storing
 * the token. Replacing keeps one worker record, one supervisor, and everything
 * they have already sent — only the credential changes. That is the ordinary
 * shape of "I lost my key", and it is honest about what happens: the old link
 * stops working the moment this runs, which is what the button says.
 */
export async function reissueFieldLink(
  _prev: AgentState,
  formData: FormData
): Promise<AgentState> {
  const user = await requireRole(["OWNER", "THERAPIST", "SPECIALIST"]);
  const linkId = String(formData.get("linkId") ?? "");

  // Scoped to the practice in the query rather than checked afterwards, so a
  // guessed id from another tenant is a not-found and never a row this code has
  // held. The supervisor check is separate: an owner may reissue anybody's, a
  // clinician only their own workers'.
  const existing = await prisma.fieldLink.findFirst({
    where: { id: linkId, practiceId: user.practiceId },
    include: { agent: { select: { id: true, fullName: true, discipline: true } } },
  });
  if (!existing) return { error: "That link no longer exists." };
  if (user.role !== "OWNER" && existing.supervisorId !== user.id) {
    return { error: "That worker is supervised by somebody else." };
  }

  const minted = await createFieldAgent({
    practiceId: user.practiceId,
    fullName: existing.agent.fullName,
    // Only read when a worker is being created; a reissue keeps the record it
    // already has. The fallback exists so the type is honest, not because a
    // field worker without a discipline would get one assigned here.
    discipline: existing.agent.discipline ?? "SOCIAL_CASE_WORKER",
    createdById: user.id,
    supervisorId: existing.supervisorId ?? user.id,
    // The same person, not a second record with the same name on it.
    existingAgentId: existing.agent.id,
  });

  // After the new one exists, never before: a failure between the two would
  // otherwise leave the worker with no way in at all.
  await revokeFieldLink(linkId, user.practiceId);

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "field.link.reissued",
    entityType: "fieldLink",
    entityId: minted.linkId,
    entityLabel: existing.agent.fullName,
    changes: { replaced: { from: linkId, to: minted.linkId } },
  });

  /*
   * No `revalidatePath` here, and that is the whole reason this comment exists.
   *
   * Revalidating re-renders the list from the server, and the row this button
   * lives in is keyed by the link id. After a reissue that id is revoked, so the
   * row re-renders as a withdrawn one with no form in it — the component
   * holding `state.created` unmounts, and the plaintext token goes with it. The
   * server side had worked perfectly: the old link revoked, a new one minted,
   * and the only copy of it discarded before anybody could read it. The worker
   * would have been locked out by the button meant to let them back in.
   *
   * So the list stays stale for one render and the credential survives, which
   * is the right way round. The next navigation shows the true state.
   */
  return {
    created: { name: existing.agent.fullName, url: `${siteUrl()}/f/${minted.token}` },
  };
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
