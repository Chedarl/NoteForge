/**
 * A practice to run assertions against, built fresh for each file.
 *
 * These tests talk to a real PostgreSQL database on purpose. Every bug this
 * codebase has actually shipped — an export where every section read "not
 * recorded", a picker whose answers hashed identically, a form that wiped
 * itself — passed a type check and a build. Mocking Prisma would reproduce that
 * exact blind spot: it tests that the code calls the functions it calls.
 *
 * Each file gets its own practice with its own code, so files can run in any
 * order and nothing depends on the seed being present or on what another test
 * left behind.
 */
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sealText } from "@/lib/crypto/text";
import type { Practice, User, Client, ClientStatus } from "@prisma/client";

export interface Fixture {
  practice: Practice;
  therapist: User;
  active: Client;
  clean: () => Promise<void>;
}

export async function makeFixture(label: string): Promise<Fixture> {
  const code = `T${randomBytes(3).toString("hex").toUpperCase()}`;

  const practice = await prisma.practice.create({
    data: { name: `Test practice ${label}`, code },
  });

  const therapist = await prisma.user.create({
    data: {
      practiceId: practice.id,
      // A real Supabase id is a uuid; anything unique will do here, and it must
      // not be null — null `authUserId` is what marks a field agent.
      authUserId: `test-${randomBytes(8).toString("hex")}`,
      email: `${code.toLowerCase()}@example.test`,
      fullName: "Test Clinician",
      role: "THERAPIST",
      discipline: "NURSE_PRACTITIONER",
      status: "ACTIVE",
    },
  });

  const active = await makeClient(practice.id, therapist.id, "ACTIVE", `${code}-0001`);

  return {
    practice,
    therapist,
    active,
    // Cascades from Practice take the users, clients, submissions and flags
    // with it, so one delete is the whole teardown.
    clean: async () => {
      await prisma.practice.delete({ where: { id: practice.id } });
    },
  };
}

export async function makeClient(
  practiceId: string,
  therapistId: string,
  status: ClientStatus,
  clientCode: string
): Promise<Client> {
  return prisma.client.create({
    data: {
      practiceId,
      clientCode,
      initials: "T.C.",
      status,
      // Sealed, and the condition tests the *status* — an earlier version
      // sealed the status and compared the ciphertext to "ACTIVE", which never
      // matched, so every fixture stored a plaintext reason. Nothing asserted
      // on it, so nothing failed.
      statusReasonEnc: status === "ACTIVE" ? null : sealText("Set by a test"),
      primaryTherapistId: therapistId,
    },
  });
}

/** Distinct prose, so nothing accidentally trips the duplicate detector. */
export function nursingFields(seed: string) {
  return {
    encounterType: "clinical_follow_up",
    modality: "in_person",
    sinceLastContact: `Since last time: ${seed}. Sleeping better than before.`,
    presentation: `Seen for review. Reports ${seed} and describes the week as steady.`,
    observations: `BP 118/76, HR 70. Weight stable. Screening score recorded as ${seed.length}.`,
    assessment: `Impression: stable presentation, ${seed}, no new concerns identified today.`,
    medication: `No change to medication. ${seed} tolerated without side effects reported.`,
    plan: `Continue as is. Review in four weeks, sooner if ${seed} changes.`,
  };
}
