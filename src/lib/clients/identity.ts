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
  /** "Maria D." — or null when no name was recorded, or it will not decrypt. */
  displayName: string | null;
  initials: string;
  birthYear: number | null;
}

type NameFields = Pick<
  Client,
  "clientCode" | "givenNameEnc" | "familyInitial" | "initials" | "birthYear"
>;

export function identityOf(client: NameFields): ClientIdentity {
  const given = decryptField(client.givenNameEnc);
  const initial = client.familyInitial?.trim();

  return {
    clientCode: client.clientCode,
    displayName: given ? (initial ? `${given} ${initial}.` : given) : null,
    initials: client.initials,
    birthYear: client.birthYear,
  };
}

/** `RVN-0142 · Maria D.` — the standard one-line label. Code always first. */
export function labelOf(client: NameFields): string {
  const identity = identityOf(client);
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
