import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { isMissingSchema } from "@/lib/db/schemaLag";
import type { DisplayPolicy } from "@/lib/clients/identity";

/**
 * Reads a practice's safe-mode setting, once per request.
 *
 * ## Why this is a separate module
 *
 * `identity.ts` is pure — give it a policy and a client row and it returns a
 * label, with no database and no request context. That is what makes it
 * testable and what makes it usable from the PDF renderer, which runs outside
 * Next.js entirely. The lookup lives here so that purity survives.
 *
 * ## Why `cache`
 *
 * A queue page renders forty rows and asks for the policy forty times. React's
 * `cache` deduplicates within one request, so it is one query per render rather
 * than one per row — and, more usefully, it means a caller never has to think
 * about whether asking again is expensive. It does *not* persist between
 * requests, which is the behaviour wanted: switching the toggle takes effect on
 * the next page load, not whenever a cache expires.
 *
 * ## Why every failure resolves to safe mode ON
 *
 * The two ways this can fail are a practice id that finds no row and a database
 * that has not run the migration adding the column. Both mean the same thing:
 * *this code does not know what this practice permits.* Answering "not safe
 * mode" there would print names on the strength of a failed lookup, which is
 * the exact shape of the bug a privacy toggle exists to prevent.
 *
 * Failing to safe mode costs a screen its names until the lookup works again,
 * and every screen already renders without them. That asymmetry decides it.
 */
export const displayPolicyFor = cache(
  async (practiceId: string): Promise<DisplayPolicy> => {
    try {
      const practice = await prisma.practice.findUnique({
        where: { id: practiceId },
        select: { safeMode: true },
      });
      // `?? true` covers the not-found case: an id with no row is not a
      // practice that permits names, it is a question with no answer.
      return { safeMode: practice?.safeMode ?? true };
    } catch (error) {
      // A database still missing the `safeMode` column throws P2022 here. The
      // session layer already redirects to `/setup-required` before most pages
      // reach this line, but the export routes and the PDF builder do not all
      // come through it, and none of them should print a name on the strength
      // of a schema error.
      if (isMissingSchema(error)) return { safeMode: true };
      throw error;
    }
  }
);
