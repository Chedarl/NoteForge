/**
 * "Filed in the practice's own system" — the last step, and the one that
 * happens outside this product.
 *
 * `DONE` has always meant *a note was produced here*. It never meant anybody
 * entered it into Credible or ICANotes, and from inside this system a note that
 * was filed and one that was forgotten looked identical. That gap is where work
 * goes missing, and it is what the practice gets asked about when a claim comes
 * back.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { submitEncounter } from "@/lib/intake/submit";
import { makeFixture, nursingFields, type Fixture } from "./_setup";

let f: Fixture;
let specialistId: string;

before(async () => {
  f = await makeFixture("processed");
  const specialist = await prisma.user.create({
    data: {
      practiceId: f.practice.id,
      authUserId: `test-spec-${f.practice.code}`,
      email: `spec-${f.practice.code.toLowerCase()}@example.test`,
      fullName: "Test Specialist",
      role: "SPECIALIST",
      status: "ACTIVE",
    },
  });
  specialistId = specialist.id;
});
after(async () => {
  await f.clean();
});

async function fileOne() {
  const result = await submitEncounter({
    practiceId: f.practice.id,
    clientId: f.active.id,
    submittedBy: f.therapist,
    kind: "STRUCTURED",
    templateKind: "NURSING",
    encounterDate: new Date(Date.now() - Math.random() * 90 * 864e5),
    fields: nursingFields(`processed ${Math.random().toString(36).slice(2)}`),
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result.submissionId;
}

describe("the processed marker", () => {
  test("a new submission is not processed", async () => {
    const id = await fileOne();
    const row = await prisma.submission.findUniqueOrThrow({ where: { id } });
    assert.equal(row.processedAt, null);
    assert.equal(row.processedById, null);
    assert.equal(row.processedNoteVersion, null);
  });

  test("it records who, when, which version and their reference", async () => {
    const id = await fileOne();
    await prisma.note.create({
      data: {
        practiceId: f.practice.id,
        clientId: f.active.id,
        submissionId: id,
        templateKind: "NURSING",
        state: "SIGNED",
        version: 3,
        signedById: specialistId,
        signedAt: new Date(),
      },
    });

    await prisma.submission.update({
      where: { id },
      data: {
        processedAt: new Date(),
        processedById: specialistId,
        processedNoteVersion: 3,
        processedRef: "CRED-88421",
      },
    });

    const row = await prisma.submission.findUniqueOrThrow({
      where: { id },
      include: { processedBy: { select: { fullName: true } } },
    });
    assert.ok(row.processedAt);
    assert.equal(row.processedBy?.fullName, "Test Specialist");
    // Which version went matters: a note corrected after signature bumps it,
    // and "which one did they get" has to have an answer.
    assert.equal(row.processedNoteVersion, 3);
    assert.equal(row.processedRef, "CRED-88421");
  });

  test("the unfiled queue is finished work nobody has confirmed", async () => {
    const filed = await fileOne();
    const notFiled = await fileOne();
    const stillInProgress = await fileOne();

    await prisma.submission.update({ where: { id: filed }, data: { state: "DONE", processedAt: new Date(), processedById: specialistId } });
    await prisma.submission.update({ where: { id: notFiled }, data: { state: "DONE" } });
    await prisma.submission.update({ where: { id: stillInProgress }, data: { state: "IN_PROGRESS" } });

    const unfiled = await prisma.submission.findMany({
      where: { practiceId: f.practice.id, state: "DONE", processedAt: null },
      select: { id: true },
    });
    const ids = unfiled.map((row) => row.id);

    assert.ok(ids.includes(notFiled), "a written note nobody filed must appear");
    assert.ok(!ids.includes(filed), "one that was filed must not");
    // Work still being written is not "finished and forgotten" — it is just
    // not finished, and putting it here would make the list meaningless.
    assert.ok(!ids.includes(stillInProgress), "work still in production must not appear");
  });

  test("clearing it removes every trace, so an undo is a real undo", async () => {
    const id = await fileOne();
    await prisma.submission.update({
      where: { id },
      data: {
        processedAt: new Date(),
        processedById: specialistId,
        processedNoteVersion: 2,
        processedRef: "REF-1",
      },
    });
    await prisma.submission.update({
      where: { id },
      data: { processedAt: null, processedById: null, processedNoteVersion: null, processedRef: null },
    });

    const row = await prisma.submission.findUniqueOrThrow({ where: { id } });
    assert.equal(row.processedAt, null);
    assert.equal(row.processedById, null);
    assert.equal(row.processedNoteVersion, null);
    assert.equal(row.processedRef, null, "a stale reference left behind would be worse than none");
  });

  test("another practice's submissions are not in this practice's unfiled list", async () => {
    const other = await makeFixture("processed-other");
    try {
      const theirs = await submitEncounter({
        practiceId: other.practice.id,
        clientId: other.active.id,
        submittedBy: other.therapist,
        kind: "STRUCTURED",
        templateKind: "NURSING",
        encounterDate: new Date(),
        fields: nursingFields("someone else"),
      });
      assert.equal(theirs.ok, true);
      if (!theirs.ok) return;
      await prisma.submission.update({ where: { id: theirs.submissionId }, data: { state: "DONE" } });

      const mine = await prisma.submission.findMany({
        where: { practiceId: f.practice.id, state: "DONE", processedAt: null },
        select: { id: true },
      });
      assert.ok(!mine.some((row) => row.id === theirs.submissionId));
    } finally {
      await other.clean();
    }
  });
});
