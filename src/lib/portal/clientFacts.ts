import "server-only";

import { prisma } from "@/lib/prisma";
import { labelsForNeeds, type NeedDefinition } from "@/lib/intake/needs";
import type { ClientFactKey } from "@/lib/portal/personas";

/**
 * The one or two things a clinician needs to know about a client without
 * opening them.
 *
 * A recovery coach wants to see that this person still has no housing and no
 * food. A nurse practitioner wants the last risk assessment and what they are
 * currently taking. Same rows on screen, different facts pulled forward — which
 * is most of what makes the three portals feel like three products rather than
 * one product with three colour schemes.
 *
 * ## Nothing here is a stored column
 *
 * There is no `ClientNeed` model. `PracticeNeed` exists but is the practice's
 * own vocabulary additions, not per-client state, and `Client` carries only
 * status, identity and `lastEncounterAt`. So every fact below is **derived from
 * the client's most recent submission of the relevant kind**, read out of the
 * `fields` JSON.
 *
 * That is a deliberate stopping point rather than a shortcut. Carrying needs
 * forward as state on the client is a real feature with real questions attached
 * — who closes a need, and does it close silently when nobody mentions it — and
 * inventing an answer here to make a dashboard look complete would be the wrong
 * order to do the work in.
 *
 * ## Queries are grouped, never per client
 *
 * A roster is unbounded and this runs on every dashboard load, so a query per
 * client is a page that gets slower as a practice grows. `distinct` with a
 * descending `orderBy` gives the latest submission per client per template kind
 * in one round trip, which is exactly the shape needed.
 *
 * ## An absent fact renders as nothing
 *
 * Never an empty chip and never a placeholder. "Risk: —" reads as *no risk
 * recorded* when it actually means *we have not asked yet*, and on a clinical
 * caseload that is the more dangerous of the two misreadings. Callers get
 * `undefined` and are expected to render nothing at all.
 */

export interface ClientFacts {
  /** Need labels, already resolved through the vocabulary. Ordered as the list defines. */
  needs?: string[];
  /** Free text as the nurse practitioner last wrote it. */
  medication?: string;
  /** How many submissions this client has, all kinds. */
  sessionCount?: number;
  /**
   * Both wait on the §3 field sets: risk needs the `severity` fields on
   * `NURSING`, and a goal is not modelled anywhere. Declared so the renderer
   * and the personas can already name them.
   */
  risk?: never;
  goal?: never;
}

/** Which template each derived fact reads from. */
const SOURCE: Partial<Record<ClientFactKey, "CASE_MANAGEMENT" | "NURSING">> = {
  needs: "CASE_MANAGEMENT",
  medication: "NURSING",
};

export async function loadClientFacts(
  practiceId: string,
  clientIds: string[],
  wanted: readonly ClientFactKey[]
): Promise<Map<string, ClientFacts>> {
  const out = new Map<string, ClientFacts>();
  if (clientIds.length === 0) return out;

  // `status` and `lastContact` come off the Client row the caller already has.
  // Asking the database for them again would be a second read of the same data.
  const fromSubmissions = wanted.filter((key) => key in SOURCE);
  const wantsCount = wanted.includes("sessionCount");
  if (fromSubmissions.length === 0 && !wantsCount) return out;

  const kinds = [...new Set(fromSubmissions.map((key) => SOURCE[key]!))];

  const [latest, counts, practiceNeeds] = await Promise.all([
    kinds.length
      ? prisma.submission.findMany({
          where: {
            practiceId,
            clientId: { in: clientIds },
            templateKind: { in: kinds },
            // A refused submission is kept on purpose, but it is not a record of
            // what is currently true — surfacing needs from one would tell a
            // coach a discharged client still has a housing problem.
            state: { notIn: ["BLOCKED", "SUPERSEDED"] },
          },
          // The latest of each kind per client, in one round trip.
          distinct: ["clientId", "templateKind"],
          orderBy: { encounterDate: "desc" },
          select: { clientId: true, templateKind: true, fields: true },
        })
      : Promise.resolve([]),
    wantsCount
      ? prisma.submission.groupBy({
          by: ["clientId"],
          where: { practiceId, clientId: { in: clientIds } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    // Local vocabulary additions, so a practice's own need reads as its label
    // rather than as `local_food_bank`.
    fromSubmissions.includes("needs")
      ? prisma.practiceNeed.findMany({ where: { practiceId } })
      : Promise.resolve([]),
  ]);

  const upsert = (clientId: string): ClientFacts => {
    const existing = out.get(clientId);
    if (existing) return existing;
    const fresh: ClientFacts = {};
    out.set(clientId, fresh);
    return fresh;
  };

  for (const row of latest) {
    const fields = (row.fields ?? {}) as Record<string, unknown>;
    const facts = upsert(row.clientId);

    if (row.templateKind === "CASE_MANAGEMENT" && fromSubmissions.includes("needs")) {
      const ids = Array.isArray(fields.needsList)
        ? fields.needsList.filter((v): v is string => typeof v === "string")
        : [];
      if (ids.length > 0) {
        facts.needs = labelsForNeeds(ids, practiceNeeds as unknown as NeedDefinition[]);
      }
    }

    if (row.templateKind === "NURSING" && fromSubmissions.includes("medication")) {
      const value = fields.medication;
      // Whitespace-only is the same as unanswered. A chip reading " " is worse
      // than no chip, because it looks like something failed to load.
      if (typeof value === "string" && value.trim().length > 0) {
        facts.medication = value.trim();
      }
    }
  }

  for (const row of counts) {
    if (row._count._all > 0) upsert(row.clientId).sessionCount = row._count._all;
  }

  return out;
}
