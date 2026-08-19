/**
 * The status guardrail, and the promise attached to it.
 *
 * This is the rule the whole product exists to enforce, so it gets the most
 * assertions. The failure it prevents is specific and has happened to real
 * people: a clinician files a note against somebody who was discharged or died,
 * the practice finds out weeks later when a claim comes back, and nobody can
 * say when the status actually changed.
 *
 * Two halves are tested, and the second matters as much as the first. Refusing
 * is easy. **Refusing without losing the clinician's work** is the part that
 * makes the rule survivable in practice — a guardrail that eats an hour of
 * writing gets worked around within a week.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { openText, sealText } from "@/lib/crypto/text";
import { submitEncounter } from "@/lib/intake/submit";
import { makeClient, makeFixture, nursingFields, type Fixture } from "./_setup";
import type { ClientStatus } from "@prisma/client";

let f: Fixture;

before(async () => {
  f = await makeFixture("guardrail");
});
after(async () => {
  await f.clean();
});

describe("the status guardrail", () => {
  test("an active client is accepted", async () => {
    const result = await submitEncounter({
      practiceId: f.practice.id,
      clientId: f.active.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NURSING",
      encounterDate: new Date(),
      fields: nursingFields("accepted"),
    });

    assert.equal(result.ok, true, "an active client must not be refused");
    if (!result.ok) return;

    const row = await prisma.submission.findUniqueOrThrow({
      where: { id: result.submissionId },
    });
    assert.equal(row.state, "QUEUED");
  });

  /*
   * Every non-active status, not just the two everyone remembers.
   *
   * "Discharged" and "deceased" are the ones named in conversation, and a check
   * written from that conversation quietly lets transfers and on-hold clients
   * through. The rule is that *only* ACTIVE accepts.
   */
  for (const status of ["ON_HOLD", "DISCHARGED", "DECEASED", "TRANSFERRED", "OTHER"] as const) {
    test(`a ${status} client is refused, and the work is kept`, async () => {
      const client = await makeClient(
        f.practice.id,
        f.therapist.id,
        status as ClientStatus,
        `${f.practice.code}-${status.slice(0, 4)}`
      );

      const narrative = `Refused-path narrative for ${status}. This text must survive.`;
      const result = await submitEncounter({
        practiceId: f.practice.id,
        clientId: client.id,
        submittedBy: f.therapist,
        kind: "STRUCTURED",
        templateKind: "NARRATIVE",
        encounterDate: new Date(),
        fields: { narrative },
      });

      assert.equal(result.ok, false, `${status} must not accept a submission`);

      const kept = await prisma.submission.findFirst({
        where: { clientId: client.id },
        include: { flags: true },
      });

      // The three halves of "refused, never discarded".
      assert.ok(kept, "the submission must still exist");
      assert.equal(kept.state, "BLOCKED");
      assert.ok(
        (openText(kept.rawTextEnc) ?? "").includes("must survive"),
        "the clinician's own words must still be readable"
      );
      assert.ok(
        !kept.rawTextEnc.includes("must survive"),
        "and must not be readable in the column itself"
      );
      assert.ok(
        kept.flags.some((flag) => flag.kind === "STATUS_BLOCK"),
        "a refusal must raise a STATUS_BLOCK flag, which is what the dashboard counts"
      );
    });
  }

  test("a client from another practice is a not-found, not an error", async () => {
    const other = await makeFixture("guardrail-other");
    try {
      const result = await submitEncounter({
        practiceId: f.practice.id,
        clientId: other.active.id,
        submittedBy: f.therapist,
        kind: "STRUCTURED",
        templateKind: "NARRATIVE",
        encounterDate: new Date(),
        fields: { narrative: "Cross-practice attempt that must find nothing." },
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      /*
       * `not_found` rather than a status refusal, and that distinction is a
       * privacy property: a guessed id from another tenant must not come back
       * with "that client is discharged", which would confirm the row exists.
       */
      assert.equal(result.reason, "not_found");

      const leaked = await prisma.submission.findFirst({
        where: { clientId: other.active.id },
      });
      assert.equal(leaked, null, "nothing may be written against another practice's client");
    } finally {
      await other.clean();
    }
  });

  test("a status change between load and submit is caught at write time", async () => {
    const client = await makeClient(
      f.practice.id,
      f.therapist.id,
      "ACTIVE",
      `${f.practice.code}-RACE`
    );

    /*
     * The scenario the rule was written for, in the order it happens: the form
     * is open and the client is fine, somebody marks them deceased, and the
     * form is submitted. Validating at render time would let this through, so
     * the check has to be here — at the write — and this test is what proves it
     * did not drift back into the form layer.
     */
    await prisma.client.update({
      where: { id: client.id },
      data: { status: "DECEASED", statusReasonEnc: sealText("Changed after the form was opened") },
    });

    const result = await submitEncounter({
      practiceId: f.practice.id,
      clientId: client.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NARRATIVE",
      encounterDate: new Date(),
      fields: { narrative: "Filed from a form that was opened before the change." },
    });

    assert.equal(result.ok, false, "the status at write time is the one that counts");
  });
});
