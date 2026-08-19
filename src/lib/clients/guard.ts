import "server-only";

import { prisma } from "@/lib/prisma";
import { openText } from "@/lib/crypto/text";
import type { Client, ClientStatus } from "@prisma/client";

/**
 * The rule this entire product was built around.
 *
 * A client whose status is not ACTIVE does not accept new submissions. Not
 * "should not" — cannot. Every intake path in the codebase goes through
 * `checkClientAcceptsSubmissions` before anything is written, and there is no
 * second way in.
 *
 * ## Why it lives here and not in the form
 *
 * The therapist portal also greys out non-active clients, and that is worth
 * doing, but it is a courtesy and not the rule. A form can be stale — the
 * client was ACTIVE when the page loaded this morning and was marked DECEASED
 * at lunchtime, and the submit at four o'clock still carries this morning's
 * assumption. Only a check that runs against the database at write time is
 * actually true. That specific sequence is the failure this product exists to
 * stop, so the check is deliberately the last thing before the insert.
 *
 * ## Why a block is a record and not just a rejection
 *
 * A refused submission writes a `STATUS_BLOCK` flag and an audit row. It has to,
 * for two reasons. The therapist tried to file something real about a real
 * session and it must not evaporate — somebody needs to work out whether the
 * status is wrong or the session predates the change. And the count of blocks
 * is the number that proves this guardrail earns its place: it is the
 * "status-accuracy" figure on the insights page, and without recording blocks
 * there would be nothing to show.
 */

export interface GuardVerdict {
  allowed: boolean;
  status: ClientStatus;
  /** The sentence the therapist actually sees. Specific, never "not allowed". */
  message?: string;
  since?: Date;
  reason?: string | null;
}

/** Only ACTIVE accepts new material. ON_HOLD included deliberately — see below. */
export function statusAcceptsSubmissions(status: ClientStatus): boolean {
  return status === "ACTIVE";
}

/**
 * ON_HOLD blocks too, and that is the contentious one.
 *
 * The argument for letting it through is that a paused client may still have a
 * legitimate late note from before the pause. The argument against — which
 * wins — is that ON_HOLD is precisely the state where the record is most likely
 * to be out of date, and a block here costs one message to the practice while a
 * wrongly-filed note costs a corrected clinical record. A genuine late note is
 * handled by an owner reactivating the client, which leaves a status event
 * explaining exactly that.
 */
const MESSAGES: Record<Exclude<ClientStatus, "ACTIVE">, string> = {
  ON_HOLD:
    "This client is On hold. New notes are not accepted while a client is paused — ask the practice owner to reactivate them if this session predates the pause.",
  DISCHARGED:
    "This client was discharged. New notes are not accepted. If this session happened before discharge, contact the practice owner so the record can be reopened deliberately.",
  TRANSFERRED:
    "This client was transferred to another provider. New notes are not accepted here.",
  DECEASED:
    "This client is recorded as deceased. New notes cannot be filed. If this is wrong, contact the practice owner immediately — nothing should be documented against this record until it is resolved.",
  // The reason is the information here, so the message points at it rather
  // than inventing a circumstance the status deliberately does not name.
  OTHER:
    "This client is not accepting new notes. The reason recorded on their status says why — ask the practice owner if it is not clear.",
};

export function verdictFor(client: Pick<Client, "status" | "statusChangedAt" | "statusReasonEnc">): GuardVerdict {
  if (statusAcceptsSubmissions(client.status)) {
    return { allowed: true, status: client.status };
  }
  return {
    allowed: false,
    status: client.status,
    message: MESSAGES[client.status as Exclude<ClientStatus, "ACTIVE">],
    since: client.statusChangedAt,
    reason: openText(client.statusReasonEnc),
  };
}

/**
 * Reads the client fresh and decides. Scoped by practice, so a guessed client id
 * from another tenant is a not-found rather than a leak.
 *
 * Returns null for the client when it does not exist or is not this practice's.
 */
export async function checkClientAcceptsSubmissions(
  clientId: string,
  practiceId: string
): Promise<{ client: Client | null; verdict: GuardVerdict | null }> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, practiceId },
  });
  if (!client) return { client: null, verdict: null };
  return { client, verdict: verdictFor(client) };
}

/**
 * Labels and colours live in `labels.ts` so client components can share them
 * without importing this server-only module. Re-exported here because server
 * code that needs the guard usually needs the label in the same breath.
 */
export { STATUS_LABEL, STATUS_CLASS } from "@/lib/clients/labels";
