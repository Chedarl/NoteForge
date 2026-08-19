import "server-only";

import { prisma } from "@/lib/prisma";
import { identityOf, MATCH_ONLY, prepareName, deriveInitials } from "@/lib/clients/identity";
import { displayPolicyFor } from "@/lib/clients/displayPolicy";
import { fieldCryptoConfigured } from "@/lib/crypto/field";
import { cleanText } from "@/lib/dedupe/normalize";

/**
 * Turning "Smith J" into a client record.
 *
 * The clinicians this replaces write a page of updates headed by a name and
 * nothing else — no code, no lookup, no form filled in beforehand. Requiring a
 * client to be created before anything can be written about them is the single
 * biggest piece of friction between that habit and this product, and it is
 * friction with no safety payoff: the guardrail, the audit trail and the
 * duplicate detector all work identically on a client created a second ago.
 *
 * So a typed name either finds the client or makes one. What it does **not** do
 * is weaken anything:
 *
 *  - The practice code is still what identifies the record (`RVN-0142`), and it
 *    is still allocated here rather than typed. The name remains a confirmation.
 *  - The name is still encrypted at rest. Without a key, quick-create is refused
 *    rather than writing plaintext — the same refusal `createClient` makes.
 *  - A new client is `ACTIVE`, so the status guardrail applies from the first
 *    submission exactly as it does to every other client.
 *
 * **On the ordering of a name.** The practice writes surname first with the
 * given initial after it, and the schema's column is called `givenNameEnc` with
 * a `familyInitial` beside it — so "Smith J" lands with "Smith" in the
 * given-name column. That is a naming mismatch and not a privacy one: both
 * halves are encrypted identically and neither is searchable. The label a
 * clinician reads back is the one they typed, which is what actually matters
 * for confirming they have the right person.
 */

export interface ResolvedClient {
  id: string;
  clientCode: string;
  /** What the clinician sees echoed back — "Smith J." */
  label: string;
  created: boolean;
}

export type ResolveResult =
  | { ok: true; client: ResolvedClient }
  | { ok: false; error: string };

/** "Smith J" / "Smith J." / "Smith" → the two columns the schema keeps. */
export function parseTypedName(input: string): { givenName: string; familyInitial: string | null } {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "", familyInitial: null };

  const last = parts[parts.length - 1].replace(/\./g, "");
  // A trailing single letter is the initial. Anything longer is part of the name.
  if (parts.length > 1 && last.length === 1) {
    return { givenName: parts.slice(0, -1).join(" "), familyInitial: last.toUpperCase() };
  }
  return { givenName: parts.join(" "), familyInitial: null };
}

/**
 * The next free code for a practice, as `<PRACTICE>-0001`.
 *
 * Derived from the highest existing number rather than a count, because a
 * deleted or renumbered client would otherwise hand out a code that is already
 * in use. The unique index is still the backstop.
 */
async function allocateClientCode(practiceId: string, practiceCode: string): Promise<string> {
  const clients = await prisma.client.findMany({
    where: { practiceId },
    select: { clientCode: true },
  });

  const prefix = `${practiceCode}-`;
  let highest = 0;
  for (const { clientCode } of clients) {
    if (!clientCode.startsWith(prefix)) continue;
    const n = Number.parseInt(clientCode.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > highest) highest = n;
  }

  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/**
 * Finds the client a typed name refers to, creating one if it is new.
 *
 * Matching happens in memory because the names are encrypted and therefore not
 * searchable by the database — a deliberate trade recorded in SECURITY.md. At
 * the scale a practice actually has (tens to low hundreds of clients) decrypting
 * the list costs nothing; if that ever stops being true, the fix is a blind
 * index, not plaintext.
 */
export async function resolveClientByName(args: {
  practiceId: string;
  typedName: string;
  /** Assigned as primary clinician when the client is created. */
  therapistId: string;
}): Promise<ResolveResult> {
  const typed = args.typedName.trim();
  if (typed.length < 2) return { ok: false, error: "Give the client a name." };
  if (typed.length > 80) return { ok: false, error: "That name is too long." };

  const { givenName, familyInitial } = parseTypedName(typed);
  if (!givenName) return { ok: false, error: "Give the client a name." };

  const policy = await displayPolicyFor(args.practiceId);

  const clients = await prisma.client.findMany({
    where: { practiceId: args.practiceId },
    select: {
      id: true,
      clientCode: true,
      givenNameEnc: true,
      familyInitial: true,
      initials: true,
      birthYear: true,
    },
  });

  // Compared after case and punctuation are normalised away, so "Smith J",
  // "smith j." and "Smith  J" are one client rather than three.
  const wanted = cleanText(`${givenName} ${familyInitial ?? ""}`);
  for (const client of clients) {
    /*
     * `MATCH_ONLY`, deliberately, and the one place in the codebase that uses
     * it. This loop is deciding *which client a typed name refers to*, not what
     * to put on a screen. Under a practice's safe-mode policy `identityOf`
     * returns no name, every comparison below would fail, and a practice that
     * turned safe mode on would quietly start creating a duplicate client every
     * time somebody typed a name the system already held — splitting one
     * person's history across two records, which is a worse outcome for the
     * record than displaying the name would ever have been.
     *
     * The name never leaves this function. What is returned as `label` is
     * re-derived under the caller's real policy below.
     */
    const identity = identityOf(MATCH_ONLY, client);
    if (!identity.displayName) continue;
    if (cleanText(identity.displayName) === wanted) {
      return {
        ok: true,
        client: {
          id: client.id,
          clientCode: client.clientCode,
          label: identity.displayName,
          created: false,
        },
      };
    }
  }

  // Also accept the code itself, so somebody who knows "RVN-0142" can type it.
  const byCode = clients.find(
    (c) => cleanText(c.clientCode) === cleanText(typed)
  );
  if (byCode) {
    const identity = identityOf(policy, byCode);
    return {
      ok: true,
      client: {
        id: byCode.id,
        clientCode: byCode.clientCode,
        label: identity.displayName ?? byCode.initials,
        created: false,
      },
    };
  }

  if (!fieldCryptoConfigured()) {
    return {
      ok: false,
      error:
        "Client names cannot be stored on this deployment — the encryption key is missing. Add the client from the Clients screen using a code instead.",
    };
  }

  const practice = await prisma.practice.findUnique({
    where: { id: args.practiceId },
    select: { code: true },
  });
  if (!practice) return { ok: false, error: "That practice could not be found." };

  const { givenNameEnc, familyInitial: initial } = prepareName({ givenName, familyInitial });

  try {
    const created = await prisma.client.create({
      data: {
        practiceId: args.practiceId,
        clientCode: await allocateClientCode(args.practiceId, practice.code),
        givenNameEnc,
        familyInitial: initial,
        initials: deriveInitials(givenName, initial),
        primaryTherapistId: args.therapistId,
        status: "ACTIVE",
      },
      select: { id: true, clientCode: true },
    });

    return {
      ok: true,
      client: {
        id: created.id,
        clientCode: created.clientCode,
        label: initial ? `${givenName} ${initial}.` : givenName,
        created: true,
      },
    };
  } catch {
    // Almost certainly the unique index on (practiceId, clientCode) losing a
    // race with another tab. Asking for a retry is honest and costs one tap.
    return { ok: false, error: "That client could not be created just now. Try again." };
  }
}
