"use server";

import { requireRole } from "@/lib/auth/session";
import { previousSubmissionFor, type PreviousSummary } from "@/lib/intake/previous";

/**
 * The one export, and it re-checks everything.
 *
 * A `"use server"` module mints a callable POST endpoint per export, so this is
 * a public route that takes a client id. It therefore does its own work rather
 * than trusting the caller: the role is re-checked, the practice comes from the
 * session and never from the request, and a therapist is scoped to their own
 * clients.
 *
 * That last part is the same restriction the export route applies, and it means
 * a guessed id from another practice returns null — a not-found, not an error
 * that would confirm the row is there.
 *
 * This is why `previous.ts` is a separate `server-only` module: the query lives
 * there and cannot be reached from the browser, and only this checked wrapper
 * is callable.
 */
export async function fetchPreviousSubmission(
  clientId: string
): Promise<PreviousSummary | null> {
  const user = await requireRole(["THERAPIST", "OWNER"]);
  if (!clientId) return null;

  return previousSubmissionFor({
    practiceId: user.practiceId,
    clientId,
    restrictToTherapistId: user.role === "THERAPIST" ? user.id : undefined,
  });
}
