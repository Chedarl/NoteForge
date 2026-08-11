"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { deriveInitials, prepareName } from "@/lib/clients/identity";
import { fieldCryptoConfigured } from "@/lib/crypto/field";
import type { Discipline } from "@prisma/client";

/**
 * Creating and naming clients, and recording a clinician's discipline.
 *
 * Both writes are guarded the same way: the name is encrypted before it reaches
 * Prisma, and the audit row records that a name was set without recording what
 * it was. An audit trail that logs the value of the field it is protecting is
 * not protecting anything.
 */

export interface ClientFormState {
  error?: string;
  ok?: boolean;
}

const clientSchema = z.object({
  clientCode: z
    .string()
    .trim()
    .min(2, "Give the client a code.")
    .max(40)
    // Codes end up in ZIP paths, URLs and filenames. Constraining the character
    // set here is cheaper than sanitising it in four places later.
    .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, "Use letters, numbers, spaces, hyphens or underscores."),
  givenName: z.string().trim().max(60).optional(),
  familyInitial: z.string().trim().max(30).optional(),
  birthYear: z.string().trim().optional(),
  primaryTherapistId: z.string().trim().optional(),
});

export async function createClient(
  _prev: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const user = await requireRole(["OWNER", "SPECIALIST", "THERAPIST"]);

  const parsed = clientSchema.safeParse({
    clientCode: formData.get("clientCode"),
    givenName: formData.get("givenName"),
    familyInitial: formData.get("familyInitial"),
    birthYear: formData.get("birthYear"),
    primaryTherapistId: formData.get("primaryTherapistId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }
  const input = parsed.data;

  if (input.givenName && !fieldCryptoConfigured()) {
    // Refusing rather than silently storing plaintext. A name written in the
    // clear because an environment variable was missing is invisible until it
    // is a breach.
    return {
      error:
        "Client names cannot be stored: FIELD_ENCRYPTION_KEY is not configured on this deployment. Leave the name blank, or set the key first.",
    };
  }

  const existing = await prisma.client.findFirst({
    where: { practiceId: user.practiceId, clientCode: input.clientCode },
    select: { id: true },
  });
  if (existing) return { error: `A client with the code ${input.clientCode} already exists.` };

  const birthYear = input.birthYear ? Number(input.birthYear) : null;
  if (birthYear !== null) {
    const thisYear = new Date().getFullYear();
    if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > thisYear) {
      return { error: "That birth year does not look right." };
    }
  }

  // A therapist may only create clients assigned to themselves. Staff choose.
  const therapistId =
    user.role === "THERAPIST" ? user.id : input.primaryTherapistId || null;
  if (therapistId && therapistId !== user.id) {
    const therapist = await prisma.user.findFirst({
      where: { id: therapistId, practiceId: user.practiceId },
      select: { id: true },
    });
    if (!therapist) return { error: "That clinician could not be found." };
  }

  const name = prepareName(input);

  const client = await prisma.client.create({
    data: {
      practiceId: user.practiceId,
      clientCode: input.clientCode,
      givenNameEnc: name.givenNameEnc,
      familyInitial: name.familyInitial,
      initials: deriveInitials(input.givenName, input.familyInitial),
      birthYear,
      primaryTherapistId: therapistId,
      status: "ACTIVE",
      statusChangedById: user.id,
    },
  });

  await prisma.clientStatusEvent.create({
    data: {
      clientId: client.id,
      fromStatus: null,
      toStatus: "ACTIVE",
      source: user.role === "THERAPIST" ? "THERAPIST_UPDATE" : "ADMIN",
      changedById: user.id,
    },
  });

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "client.created",
    entityType: "client",
    entityId: client.id,
    entityLabel: client.clientCode,
    // Records *that* a name was set, never the name itself.
    changes: { nameRecorded: { from: false, to: Boolean(name.givenNameEnc) } },
  });

  revalidatePath("/t");
  revalidatePath("/s/clients");
  redirect(user.role === "THERAPIST" ? "/t" : `/s/clients/${client.id}`);
}

/** Updates just the name fields on an existing client. */
export async function updateClientName(
  _prev: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const user = await requireRole(["OWNER", "SPECIALIST", "THERAPIST"]);

  const clientId = String(formData.get("clientId") ?? "");
  const givenName = String(formData.get("givenName") ?? "").trim();
  const familyInitial = String(formData.get("familyInitial") ?? "").trim();

  if (givenName && !fieldCryptoConfigured()) {
    return { error: "FIELD_ENCRYPTION_KEY is not configured, so names cannot be stored." };
  }

  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      practiceId: user.practiceId,
      ...(user.role === "THERAPIST" ? { primaryTherapistId: user.id } : {}),
    },
    select: { id: true, clientCode: true, givenNameEnc: true },
  });
  if (!client) return { error: "That client could not be found." };

  const name = prepareName({ givenName, familyInitial });

  await prisma.client.update({
    where: { id: client.id },
    data: {
      givenNameEnc: name.givenNameEnc,
      familyInitial: name.familyInitial,
      initials: deriveInitials(givenName, familyInitial),
    },
  });

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "client.name_updated",
    entityType: "client",
    entityId: client.id,
    entityLabel: client.clientCode,
    changes: {
      nameRecorded: { from: Boolean(client.givenNameEnc), to: Boolean(name.givenNameEnc) },
    },
  });

  revalidatePath("/t");
  revalidatePath(`/s/clients/${client.id}`);
  return { ok: true };
}

/**
 * A clinician recording which discipline they work in.
 *
 * Self-service rather than administered, because the person who knows is the
 * clinician, and a field that requires an owner to set it is a field that stays
 * null. It stamps every submission they make from this point on; existing
 * submissions are untouched, because retroactively asserting a discipline on an
 * encounter nobody labelled would be putting a fact into the record that was
 * never stated.
 */
export async function setDiscipline(
  _prev: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const user = await requireRole(["OWNER", "SPECIALIST", "THERAPIST"]);
  const discipline = String(formData.get("discipline") ?? "") as Discipline;

  const allowed: Discipline[] = [
    "SOCIAL_CASE_WORKER",
    "NURSE_PRACTITIONER",
    "THERAPIST",
    "COUNSELLOR",
    "OTHER",
  ];
  if (!allowed.includes(discipline)) return { error: "Choose one of the options." };

  await prisma.user.update({ where: { id: user.id }, data: { discipline } });

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "user.discipline_set",
    entityType: "user",
    entityId: user.id,
    entityLabel: user.fullName,
    changes: { discipline: { from: user.discipline, to: discipline } },
  });

  revalidatePath("/t");
  return { ok: true };
}
