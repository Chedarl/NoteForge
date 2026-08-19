/**
 * "What was recorded last time", and the four things it must never get wrong.
 *
 * This is the §4 clause the client called one of the highest-value features. It
 * is also a read that crosses a practice boundary if anybody is careless with
 * it, and one that would mislead a clinician if it picked the wrong submission.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { submitEncounter } from "@/lib/intake/submit";
import { previousSubmissionFor } from "@/lib/intake/previous";
import { makeClient, makeFixture, nursingFields, type Fixture } from "./_setup";

let f: Fixture;

before(async () => {
  f = await makeFixture("previous");
});
after(async () => {
  await f.clean();
});

describe("the last encounter shown at intake", () => {
  test("a client with no history has none", async () => {
    const fresh = await makeClient(f.practice.id, f.therapist.id, "ACTIVE", `${f.practice.code}-NEW`);
    const summary = await previousSubmissionFor({
      practiceId: f.practice.id,
      clientId: fresh.id,
    });
    assert.equal(summary, null, "a first record must not invent a previous one");
  });

  test("it is the latest encounter by session date, not by upload", async () => {
    const client = await makeClient(f.practice.id, f.therapist.id, "ACTIVE", `${f.practice.code}-ORD`);

    // Filed second, but the session happened first. Handover runs late all the
    // time; ordering by createdAt would call this one "last time".
    await submitEncounter({
      practiceId: f.practice.id, clientId: client.id, submittedBy: f.therapist,
      kind: "STRUCTURED", templateKind: "NURSING",
      encounterDate: new Date("2026-06-01"),
      fields: { ...nursingFields("the older session"), medication: "Sertraline 50mg, older." },
    });
    await submitEncounter({
      practiceId: f.practice.id, clientId: client.id, submittedBy: f.therapist,
      kind: "STRUCTURED", templateKind: "NURSING",
      encounterDate: new Date("2026-07-15"),
      fields: { ...nursingFields("the newer session"), medication: "Sertraline 150mg, newer." },
    });

    const summary = await previousSubmissionFor({ practiceId: f.practice.id, clientId: client.id });
    assert.ok(summary);
    assert.equal(summary.encounterDate, "2026-07-15");
    assert.ok(
      summary.facts.some((fact) => fact.value.includes("newer")),
      "the facts must come from the latest encounter"
    );
  });

  test("a refused submission is never shown as history", async () => {
    const blocked = await makeClient(
      f.practice.id, f.therapist.id, "DISCHARGED", `${f.practice.code}-REF`
    );
    await submitEncounter({
      practiceId: f.practice.id, clientId: blocked.id, submittedBy: f.therapist,
      kind: "STRUCTURED", templateKind: "NARRATIVE",
      encounterDate: new Date(),
      fields: { narrative: "Refused material that must not be presented as established history." },
    });

    const summary = await previousSubmissionFor({
      practiceId: f.practice.id,
      clientId: blocked.id,
    });
    // It was kept for reconciliation, but it never entered the record — showing
    // it as "last time" would tell a clinician something that is not true.
    assert.equal(summary, null);
  });

  test("another practice's client returns nothing", async () => {
    const other = await makeFixture("previous-other");
    try {
      await submitEncounter({
        practiceId: other.practice.id, clientId: other.active.id, submittedBy: other.therapist,
        kind: "STRUCTURED", templateKind: "NURSING",
        encounterDate: new Date(), fields: nursingFields("someone else's client"),
      });

      const summary = await previousSubmissionFor({
        practiceId: f.practice.id,
        clientId: other.active.id,
      });
      assert.equal(summary, null, "a guessed id from another tenant must find nothing");
    } finally {
      await other.clean();
    }
  });

  test("a therapist sees their own clients' history and not a colleague's", async () => {
    const colleague = await prisma.user.create({
      data: {
        practiceId: f.practice.id,
        authUserId: `test-colleague-${f.practice.code}`,
        email: `colleague-${f.practice.code.toLowerCase()}@example.test`,
        fullName: "Another Clinician",
        role: "THERAPIST",
        discipline: "NURSE_PRACTITIONER",
        status: "ACTIVE",
      },
    });
    const theirClient = await makeClient(
      f.practice.id, colleague.id, "ACTIVE", `${f.practice.code}-COL`
    );
    await submitEncounter({
      practiceId: f.practice.id, clientId: theirClient.id, submittedBy: colleague,
      kind: "STRUCTURED", templateKind: "NURSING",
      encounterDate: new Date(), fields: nursingFields("a colleague's caseload"),
    });

    const asOwner = await previousSubmissionFor({
      practiceId: f.practice.id,
      clientId: theirClient.id,
    });
    assert.ok(asOwner, "an owner sees the whole practice");

    const asTherapist = await previousSubmissionFor({
      practiceId: f.practice.id,
      clientId: theirClient.id,
      restrictToTherapistId: f.therapist.id,
    });
    assert.equal(asTherapist, null, "a therapist is scoped to their own");
  });

  test("it carries the clinician's own account and the fields worth reading", async () => {
    const client = await makeClient(f.practice.id, f.therapist.id, "ACTIVE", `${f.practice.code}-FAC`);
    await submitEncounter({
      practiceId: f.practice.id, clientId: client.id, submittedBy: f.therapist,
      kind: "STRUCTURED", templateKind: "NURSING",
      encounterDate: new Date(),
      fields: {
        ...nursingFields("facts"),
        encounterType: "crisis",
        sinceLastContact: "Rang the out-of-hours line overnight.",
        riskSuicidal: { level: "active_no_plan", note: "Reviewed the safety plan on the call." },
        medication: "Sertraline 150mg daily, unchanged, adherent.",
      },
    });

    const summary = await previousSubmissionFor({ practiceId: f.practice.id, clientId: client.id });
    assert.ok(summary);
    assert.equal(summary.encounterType, "Crisis", "the type is what was chosen, not the template");
    assert.equal(summary.clinicianStatement, "Rang the out-of-hours line overnight.");

    const risk = summary.facts.find((fact) => fact.label === "Suicidal ideation");
    assert.ok(risk, "risk must be one of the surfaced facts on a nursing encounter");
    assert.ok(risk.value.includes("Active, no plan"), "as a label, never an id");

    // Nothing is pre-filled from this, so the value being readable prose rather
    // than a form value is the whole contract.
    assert.ok(summary.facts.some((fact) => fact.label === "Medication"));
  });
});
