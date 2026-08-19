/**
 * The two things automatic delivery must never do.
 *
 * This path sends a clinical note to a note writer without anybody looking at
 * it first, which is a deliberate decision by the practice. What makes that
 * decision survivable is not the sending — it is the two refusals underneath it,
 * and neither was asserted anywhere when the path was written:
 *
 *  1. **It must not send when there is nothing to send.** The screen that
 *     prompted the whole change showed a photographed page the reader returned
 *     nothing for. Delivering there hands somebody an empty document carrying a
 *     client code, which they cannot tell from a quiet week.
 *  2. **It must not sign.** The note goes out at once and the record still has
 *     to answer "did a person put their name to this" with *no*. A future change
 *     that sets `signedById` here would be invisible in review and impossible to
 *     walk back once an audit asks.
 *
 * Against a real database, because the failure mode being guarded is a row
 * being written with the wrong contents — exactly what a mock cannot show.
 */

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { openText, isSealed } from "@/lib/crypto/text";
import { submitEncounter } from "@/lib/intake/submit";
import { autoDeliverSubmission } from "@/lib/intake/autoDeliver";
import { makeFixture, type Fixture } from "./_setup";

let fx: Fixture;
before(async () => {
  fx = await makeFixture("autodeliver");
});
after(async () => {
  await fx.clean();
});

describe("automatic delivery", () => {
  test("refuses a submission with no text rather than sending an empty note", async () => {
    // A photo submission whose pages carry no transcript — the exact state the
    // reader leaves behind when it cannot read the image.
    const result = await submitEncounter({
      practiceId: fx.practice.id,
      clientId: fx.active.id,
      submittedBy: fx.therapist,
      kind: "PHOTO",
      templateKind: "NARRATIVE",
      encounterDate: new Date(),
      fields: {},
    });
    assert.ok(result.ok, "the submission itself must still be accepted");
    if (!result.ok) return;

    await prisma.submissionPage.create({
      data: {
        submissionId: result.submissionId,
        pageNumber: 1,
        storagePath: "note-pages/test/blank.png",
        // Null, not empty string: this is what an unread page looks like.
        ocrTextEnc: null,
        verifiedTextEnc: null,
      },
    });

    const outcome = await autoDeliverSubmission(result.submissionId, fx.therapist);
    assert.equal(outcome.ok, false, "must not deliver");
    if (outcome.ok) return;
    assert.equal(outcome.reason, "no_text");

    // And nothing may have been produced from it.
    const note = await prisma.note.findUnique({
      where: { submissionId: result.submissionId },
      select: { id: true },
    });
    assert.equal(note, null, "no note may exist for a submission with no source text");

    const share = await prisma.shareLink.findFirst({
      where: { submissionId: result.submissionId },
      select: { id: true },
    });
    assert.equal(share, null, "nothing may have been shared");
  });

  test("a machine-written note is never signed and never claims an author", async () => {
    /*
     * Asserted against the row rather than the return value, because the return
     * value is what the code *says* it did. Whether a note counts as signed is
     * decided by three columns, and this is the assertion that would fail if
     * somebody later "finished" this path by setting them.
     */
    const result = await submitEncounter({
      practiceId: fx.practice.id,
      clientId: fx.active.id,
      submittedBy: fx.therapist,
      kind: "STRUCTURED",
      templateKind: "NARRATIVE",
      encounterDate: new Date(),
      fields: { narrative: "Attended as arranged. Sleeping better since the change." },
    });
    assert.ok(result.ok);
    if (!result.ok) return;

    // Runs with whatever model configuration the environment has. With no key
    // it refuses at `no_model`, which is itself a correct outcome — the point
    // of this test is that *if* a note is produced, it is unsigned.
    await autoDeliverSubmission(result.submissionId, fx.therapist);

    const note = await prisma.note.findUnique({
      where: { submissionId: result.submissionId },
      select: { state: true, aiAssisted: true, signedById: true, signedAt: true, authoredById: true },
    });

    if (note) {
      assert.equal(note.state, "DRAFT", "an unattended note must stay a draft");
      assert.equal(note.aiAssisted, true, "it must be recorded as machine-written");
      assert.equal(note.signedById, null, "nothing may sign on a person's behalf");
      assert.equal(note.signedAt, null);
      assert.equal(note.authoredById, null, "no human may be named as the author");
    }
  });

  test("the test fixture itself seals what it stores", async () => {
    /*
     * Guards the fixture, not the product — and it earned its place. A refactor
     * left `_setup.ts` sealing the *status* and comparing the ciphertext to
     * "ACTIVE", which never matched, so every non-active fixture client stored a
     * plaintext status reason. Every test still passed, because nothing looked.
     */
    const client = await prisma.client.findFirst({
      where: { practiceId: fx.practice.id, NOT: { statusReasonEnc: null } },
      select: { statusReasonEnc: true },
    });
    if (client?.statusReasonEnc) {
      assert.ok(isSealed(client.statusReasonEnc), "a fixture reason must be sealed");
      assert.ok((openText(client.statusReasonEnc) ?? "").length > 0, "and must open again");
    }
  });
});
