import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Discipline, User } from "@prisma/client";

/**
 * Links that let somebody submit without ever having an account.
 *
 * A recovery coach or case worker in the field is not going to be issued a
 * password, remember it, and type it on a phone between visits. What they will
 * do is tap a link that is already on their home screen. So the link *is* the
 * credential — which puts the whole weight of access control on how it is
 * minted, stored and withdrawn.
 *
 * Three decisions carry that weight:
 *
 * **The token is never stored.** Only its SHA-256. A leaked database backup
 * yields hashes, and a hash cannot be tapped. This mirrors `ShareLink`, which
 * made the same choice for the same reason.
 *
 * **It does not expire.** Deliberately, and it is the difference between this
 * and a share link. A document link is finished the moment it is downloaded; a
 * worker's way in is used every day for a year, and an expiry would mean the
 * feature quietly stops working at the worst moment. The control is revocation,
 * which is immediate and per-person.
 *
 * **One link, one named person.** Not one per practice. A shared link tells you
 * nothing about who filed what, and cannot be withdrawn from one person without
 * withdrawing it from everybody — which in practice means it is never withdrawn
 * at all.
 */

/** 32 bytes, base64url: the same entropy the share links use. */
const TOKEN_BYTES = 32;

export function mintFieldToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashFieldToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Shape a token must have before it is worth a database round trip. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface FieldAgentSession {
  linkId: string;
  practiceId: string;
  agent: User;
}

/**
 * Resolves a token to the agent it speaks for, or null.
 *
 * Everything is a null: a malformed token, an unknown one, a revoked link, a
 * suspended agent. The caller shows one message for all of them, because
 * telling a stranger *which* of those it was is telling them whether they have
 * found a real link.
 */
export async function resolveFieldLink(token: string): Promise<FieldAgentSession | null> {
  if (!TOKEN_PATTERN.test(token)) return null;

  const link = await prisma.fieldLink.findUnique({
    where: { tokenHash: hashFieldToken(token) },
    include: { agent: true },
  });

  if (!link || link.revokedAt !== null) return null;
  if (link.agent.status !== "ACTIVE") return null;
  // A link whose agent was moved to another practice is not a link any more.
  if (link.agent.practiceId !== link.practiceId) return null;

  return { linkId: link.id, practiceId: link.practiceId, agent: link.agent };
}

/**
 * Records that a link was used.
 *
 * Separate from resolving, and never awaited on the render path: a page load
 * that fails because a counter could not be written would be a worse product
 * than one whose usage figures are occasionally short by one.
 */
export async function noteFieldLinkUse(linkId: string): Promise<void> {
  await prisma.fieldLink
    .update({
      where: { id: linkId },
      data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
    })
    .catch(() => {});
}

export interface MintedLink {
  token: string;
  agentId: string;
  linkId: string;
}

/**
 * Creates the agent and their link together.
 *
 * The agent is a `User` with `FIELD_AGENT`, no `authUserId` and no email. That
 * null is the access control: signing in matches a Supabase id against this
 * column, and no real id equals null, so a field agent cannot log in even if
 * somebody later gives them a password. It fails closed by construction rather
 * than by a check somebody has to remember to write.
 *
 * The plaintext token is returned exactly once, here. There is no route that
 * can show it again — only a new one can be minted — which is the same
 * discipline any credential deserves.
 */
export async function createFieldAgent(input: {
  practiceId: string;
  fullName: string;
  discipline: Discipline;
  createdById: string;
}): Promise<MintedLink> {
  const token = mintFieldToken();

  const { agentId, linkId } = await prisma.$transaction(async (tx) => {
    const agent = await tx.user.create({
      data: {
        practiceId: input.practiceId,
        fullName: input.fullName,
        role: "FIELD_AGENT",
        discipline: input.discipline,
        authUserId: null,
        email: null,
      },
    });
    const link = await tx.fieldLink.create({
      data: {
        practiceId: input.practiceId,
        agentId: agent.id,
        createdById: input.createdById,
        tokenHash: hashFieldToken(token),
      },
    });
    return { agentId: agent.id, linkId: link.id };
  });

  return { token, agentId, linkId };
}

/** Withdraws one person's access without touching anybody else's. */
export async function revokeFieldLink(linkId: string, practiceId: string): Promise<boolean> {
  const result = await prisma.fieldLink.updateMany({
    where: { id: linkId, practiceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Constant-time comparison, exported for tests.
 *
 * Not used on the lookup path — that goes through a hashed unique index, which
 * does not leak timing about the token itself — but kept here so any future
 * comparison of secrets in this module has the right tool to hand.
 */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
