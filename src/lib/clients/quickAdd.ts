"use server";

import { requireRole } from "@/lib/auth/session";
import { resolveClientByName } from "@/lib/clients/resolve";
import { writeAudit } from "@/lib/audit";
import type { ResolvedClient } from "@/lib/clients/resolve";

/**
 * Adding a client from inside the note form.
 *
 * ## Why this exists
 *
 * The structured form's client picker only ever offered clients who already
 * existed, so meeting somebody new meant leaving a part-written note to go and
 * create them. React resets an uncontrolled form when you come back to it, and
 * the codebase already carries two comments about how expensive that is. A
 * clinician who loses twenty fields once files shorter notes afterwards, or
 * stops using the form at all — which is exactly the friction the one-box
 * quick-update path was built to remove, and the structured path never got.
 *
 * ## Why it is a wrapper and not its own logic
 *
 * `resolveClientByName` already finds-or-creates from a typed name, allocates
 * the practice code, encrypts the name and refuses when no key is configured.
 * It is the same function `/t/write` uses, so a client created from the note
 * form and a client created from the quick-update path are created identically
 * — including the fact that a name matching an existing client returns *that*
 * client rather than making a second one. Reimplementing any of that here is
 * how two paths drift until one of them stops encrypting something.
 *
 * ## What it does not do
 *
 * It does not submit anything, and it does not touch the note being written.
 * Rule 0 is intact: this creates a `Client`, and the encounter still goes
 * through `submitEncounter` when the clinician presses the button they were
 * always going to press.
 */
export type QuickAddResult =
  | { ok: true; client: ResolvedClient }
  | { ok: false; error: string };

export async function quickAddClient(typedName: string): Promise<QuickAddResult> {
  // A server action is a public POST endpoint, so the role check is here and
  // not on the screen that calls it.
  const user = await requireRole(["THERAPIST", "OWNER"]);

  const result = await resolveClientByName({
    practiceId: user.practiceId,
    typedName,
    // A therapist's new client is their own; an owner writing a note is acting
    // as the clinician, so the same rule reads correctly for both.
    therapistId: user.id,
  });

  if (!result.ok) return result;

  // Only a creation is audited. Matching an existing client is a read, and this
  // path already logs reads where they matter; a row per keystroke-resolved
  // lookup would bury the creations that a practice actually reviews.
  if (result.client.created) {
    await writeAudit({
      practiceId: user.practiceId,
      actor: user,
      action: "client.created",
      entityType: "client",
      entityId: result.client.id,
      entityLabel: result.client.clientCode,
      changes: { source: { from: null, to: "note form" } },
    });
  }

  return result;
}
