import "server-only";

import { decryptField, encryptField } from "@/lib/crypto/field";
import type { Client } from "@prisma/client";

/**
 * How a client is named on screen.
 *
 * The rule everywhere in this application: **the client code is the identifier
 * and the name is a confirmation.** Every heading, every queue row and every
 * export filename leads with the code. The name appears beside it so a person
 * can be certain they have the right record, which is the whole reason it is
 * collected — and the reason it is a first name and an initial rather than a
 * full identity.
 *
 * That ordering is not cosmetic. It means every screenshot, every URL, every
 * log line and every filename in a Downloads folder carries `RVN-0142` and not
 * somebody's name.
 */

export interface ClientIdentity {
  clientCode: string;
  /**
   * "Maria D." — or null when no name was recorded, it will not decrypt, or
   * the practice is in safe mode.
   *
   * All three collapse to the same null on purpose. Every screen in this
   * product already handles a nameless client, because a client may genuinely
   * have no name recorded, and that fallback path has been exercised since the
   * first day. Safe mode reuses it rather than adding a second one, which is
   * why turning it on changes no layout anywhere.
   */
  displayName: string | null;
  initials: string;
  birthYear: number | null;
}

/**
 * What this practice permits to be shown.
 *
 * This is a parameter and not a module-level lookup, and it is the **first**
 * parameter and not an optional trailing one, for a single reason: making it
 * optional would have meant every one of the twenty existing call sites kept
 * compiling and kept printing names. A privacy control whose absence is
 * indistinguishable from "off" is not a control, it is a setting nobody
 * noticed. Required, the compiler names every place that has to answer the
 * question — and `Client` has no `safeMode` field, so a client passed in the
 * policy's position does not type-check either.
 */
export interface DisplayPolicy {
  /** True when this practice has asked that names never be shown. */
  safeMode: boolean;
}

/**
 * The policy for code that is *matching* a name, never showing one.
 *
 * `resolve.ts` compares what a clinician typed against the stored names to find
 * the right client. That comparison has to see the real name in safe mode too,
 * or a practice that turned safe mode on would silently start creating a second
 * client every time somebody typed a name it already held — which is worse for
 * the record than showing the name would have been.
 *
 * It is a named constant rather than a literal at the call site so that
 * `grep MATCH_ONLY` is the complete list of places that deliberately bypass the
 * toggle. Today that is one function, and anything added to the list is a
 * decision somebody has to defend in review.
 */
export const MATCH_ONLY: DisplayPolicy = { safeMode: false };

type NameFields = Pick<
  Client,
  "clientCode" | "givenNameEnc" | "familyInitial" | "initials" | "birthYear"
>;

export function identityOf(policy: DisplayPolicy, client: NameFields): ClientIdentity {
  const given = policy.safeMode ? null : decryptField(client.givenNameEnc);
  const initial = client.familyInitial?.trim();

  return {
    clientCode: client.clientCode,
    displayName: given ? (initial ? `${given} ${initial}.` : given) : null,
    initials: client.initials,
    birthYear: client.birthYear,
  };
}

/** `RVN-0142 · Maria D.` — the standard one-line label. Code always first. */
export function labelOf(policy: DisplayPolicy, client: NameFields): string {
  const identity = identityOf(policy, client);
  return identity.displayName
    ? `${identity.clientCode} · ${identity.displayName}`
    : `${identity.clientCode} · ${identity.initials}`;
}

/**
 * Prepares name fields for writing.
 *
 * Normalises the surname down to a single uppercase letter *here*, at the
 * boundary, rather than trusting the form. A field labelled "surname initial"
 * receives a full surname often enough that validating it is not paranoia, and
 * one truncation in one place is easier to trust than a rule repeated in three
 * forms.
 */
export function prepareName(input: {
  givenName?: string | null;
  familyInitial?: string | null;
}): { givenNameEnc: string | null; familyInitial: string | null } {
  const given = input.givenName?.trim() || null;
  const rawInitial = input.familyInitial?.trim() || "";
  const initial = rawInitial ? rawInitial[0].toUpperCase() : null;

  return {
    givenNameEnc: encryptField(given),
    familyInitial: initial,
  };
}

/**
 * Initials, derived when the practice does not supply them.
 *
 * Initials remain a separate stored column rather than being computed from the
 * name on every read: they are the fallback that keeps every screen working
 * when the encryption key is unavailable or has been rotated, and a fallback
 * that depends on the thing it is a fallback for is not one.
 */
export function deriveInitials(
  givenName: string | null | undefined,
  familyInitial: string | null | undefined
): string {
  const first = givenName?.trim()?.[0]?.toUpperCase();
  const last = familyInitial?.trim()?.[0]?.toUpperCase();
  if (first && last) return `${first}.${last}.`;
  if (first) return `${first}.`;
  return "—";
}
