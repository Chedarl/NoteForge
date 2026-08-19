/**
 * Duplicate detection, and the thing that silently broke it once.
 *
 * The detector runs cheapest-layer-first: an exact hash match, then token
 * overlap, then — only if those are inconclusive — a model call. All of that
 * rests on `flattenFields`, which turns a submission's answers into the text
 * everything downstream hashes and compares.
 *
 * When `flattenFields` dropped non-string values, a submission whose answers
 * were all pickers flattened to an empty string. Every such submission then
 * hashed identically, and the detector flagged all of them against each other.
 * Nothing threw, nothing logged, and the queue filled with false duplicates.
 * These tests exist so that particular silence cannot come back.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { submitEncounter } from "@/lib/intake/submit";
import { flattenFields } from "@/lib/intake/templates";
import { makeFixture, nursingFields, type Fixture } from "./_setup";

let f: Fixture;

before(async () => {
  f = await makeFixture("dedupe");
});
after(async () => {
  await f.clean();
});

describe("what a submission flattens to", () => {
  test("a picker's answers reach the text, as labels", () => {
    const text = flattenFields("NURSING", {
      ...nursingFields("pickers"),
      symptoms: ["sleep", "anxiety"],
    });

    assert.ok(text.includes("Sleep"), "a multi field's labels must be in the flattened text");
    assert.ok(text.includes("Anxiety"));
    assert.ok(!text.includes('["sleep"'), "never the raw array");
  });

  test("a severity answer reaches the text, level and note both", () => {
    const text = flattenFields("NURSING", {
      ...nursingFields("severity"),
      riskSuicidal: { level: "passive", note: "Thoughts of not waking up, no plan." },
    });

    assert.ok(text.includes("Passive"), "the level must be there, as its label");
    assert.ok(text.includes("no plan"), "and the note beside it");
    assert.ok(!text.includes("[object Object]"), "the object must never be stringified raw");
  });

  test("a choice answer reaches the text as its label, never its id", () => {
    const text = flattenFields("NURSING", nursingFields("choices"));
    assert.ok(text.includes("Clinical follow-up"));
    assert.ok(!text.includes("clinical_follow_up"), "ids are stored, labels are rendered");
  });

  /*
   * The regression itself, stated as an assertion.
   *
   * Two submissions differing only in their picker answers must not flatten to
   * the same text — because identical text means an identical hash, and an
   * identical hash means the detector calls them the same encounter.
   */
  test("submissions differing only in pickers do not flatten alike", () => {
    const base = nursingFields("same prose everywhere");
    const a = flattenFields("NURSING", { ...base, symptoms: ["sleep"] });
    const b = flattenFields("NURSING", { ...base, symptoms: ["sleep", "anxiety", "appetite"] });
    assert.notEqual(a, b, "a change in what was ticked is a change in the submission");
  });
});

describe("hashing, through the real intake door", () => {
  test("two different encounters hash differently", async () => {
    const first = await submitEncounter({
      practiceId: f.practice.id,
      clientId: f.active.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NURSING",
      encounterDate: new Date(Date.now() - 40 * 864e5),
      fields: { ...nursingFields("first visit"), symptoms: ["sleep"] },
    });
    const second = await submitEncounter({
      practiceId: f.practice.id,
      clientId: f.active.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NURSING",
      encounterDate: new Date(Date.now() - 20 * 864e5),
      fields: { ...nursingFields("second visit"), symptoms: ["anxiety", "energy"] },
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;

    const rows = await prisma.submission.findMany({
      where: { id: { in: [first.submissionId, second.submissionId] } },
      select: { contentHash: true, rawText: true, normalizedText: true },
    });

    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].contentHash, rows[1].contentHash);
    for (const row of rows) {
      assert.ok(row.rawText.length > 40, "a picker-carrying submission must not flatten to nothing");
      assert.ok(row.normalizedText.length > 0, "and the token index must not be empty either");
    }
  });

  test("the same encounter filed twice is flagged, not merged", async () => {
    const fields = { ...nursingFields("identical handover"), symptoms: ["sleep"] };
    const day = new Date(Date.now() - 5 * 864e5);

    const first = await submitEncounter({
      practiceId: f.practice.id,
      clientId: f.active.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NURSING",
      encounterDate: day,
      fields,
    });
    const second = await submitEncounter({
      practiceId: f.practice.id,
      clientId: f.active.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NURSING",
      encounterDate: day,
      fields,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;

    // Both rows survive. Nothing is merged and nothing is deleted — a duplicate
    // is a question for a person, never a decision the machine makes.
    const both = await prisma.submission.findMany({
      where: { id: { in: [first.submissionId, second.submissionId] } },
    });
    assert.equal(both.length, 2, "a duplicate must never remove the earlier submission");

    const flags = await prisma.submissionFlag.findMany({
      where: { submissionId: second.submissionId },
    });
    assert.ok(flags.length > 0, "the second one must carry a flag for a person to resolve");
    assert.ok(
      flags.some((flag) => flag.kind === "DUPLICATE" || flag.kind === "NEAR_DUPLICATE"),
      `expected a duplicate flag, got ${flags.map((x) => x.kind).join(", ")}`
    );
  });

  test("another practice's identical text is not a duplicate of ours", async () => {
    const other = await makeFixture("dedupe-other");
    try {
      const fields = { ...nursingFields("shared wording across practices"), symptoms: ["sleep"] };

      const mine = await submitEncounter({
        practiceId: f.practice.id,
        clientId: f.active.id,
        submittedBy: f.therapist,
        kind: "STRUCTURED",
        templateKind: "NURSING",
        encounterDate: new Date(Date.now() - 2 * 864e5),
        fields,
      });
      const theirs = await submitEncounter({
        practiceId: other.practice.id,
        clientId: other.active.id,
        submittedBy: other.therapist,
        kind: "STRUCTURED",
        templateKind: "NURSING",
        encounterDate: new Date(Date.now() - 2 * 864e5),
        fields,
      });

      assert.equal(mine.ok, true);
      assert.equal(theirs.ok, true);
      if (!theirs.ok) return;

      const flags = await prisma.submissionFlag.findMany({
        where: { submissionId: theirs.submissionId },
      });
      // Practice scoping is not only a privacy rule. Comparing across tenants
      // would leak the existence of another practice's records through a flag.
      assert.equal(
        flags.length,
        0,
        "duplicate detection must never reach across practices"
      );
    } finally {
      await other.clean();
    }
  });
});
