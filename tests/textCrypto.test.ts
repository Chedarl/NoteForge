/**
 * The clinical-text envelope, in both directions and at its edges.
 *
 * This column holds the thing the whole product exists to move around, and the
 * two failure directions are not symmetrical:
 *
 *  - Treating a **legacy plaintext** note as a corrupt envelope blanks every
 *    historical row. Silent, total, and only visible to whoever opens an export
 *    months later.
 *  - Handing back **ciphertext** as though it were text puts base64 on a PDF, in
 *    a WhatsApp link and in a note writer's ZIP, with nothing to say it failed.
 *
 * So both are asserted, along with the round trip through the kinds of text a
 * clinician actually produces — accents, emoji, newlines, colons, and prose that
 * begins with something envelope-shaped.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  sealText,
  openText,
  isSealed,
  sealJson,
  openJson,
  isSealedJson,
} from "@/lib/crypto/text";

const KEY = "test-only-text-key-0123456789abcdefghijklmnop";
let saved: string | undefined;

before(() => {
  saved = process.env.FIELD_ENCRYPTION_KEY;
  process.env.FIELD_ENCRYPTION_KEY = KEY;
});
after(() => {
  if (saved === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = saved;
});

const NOTE =
  "Client reports sleeping better since the medication change; mood fair.\n" +
  "Denies SI/HI/AVH. BP 120/80 & stable, <2 units daily. Café visit at 14:30.\n" +
  "Plan: review in 2/52. Naïve to prior treatment — see attached. 🙂";

describe("sealing clinical text", () => {
  test("round trips exactly, including newlines, accents and punctuation", () => {
    const sealed = sealText(NOTE);
    assert.notEqual(sealed, NOTE);
    assert.equal(openText(sealed), NOTE);
  });

  test("the ciphertext contains none of the plaintext", () => {
    // The property that actually matters to a database dump. Checked on words
    // long enough not to collide with base64 by chance.
    const sealed = sealText(NOTE);
    for (const word of ["sleeping", "medication", "Denies", "Café", "review"]) {
      assert.ok(!sealed.includes(word), `${word} must not survive in the ciphertext`);
    }
  });

  test("the same text seals differently every time", () => {
    // Random IV per value: otherwise identical notes are visibly identical in
    // the database, which leaks that two encounters said the same thing.
    const a = sealText(NOTE);
    const b = sealText(NOTE);
    assert.notEqual(a, b);
    assert.equal(openText(a), openText(b));
  });

  test("empty stays empty rather than becoming an envelope", () => {
    assert.equal(sealText(""), "");
    assert.equal(sealText(null), "");
    assert.equal(sealText(undefined), "");
    assert.equal(openText(""), "");
  });

  test("legacy plaintext is returned unchanged", () => {
    // The compatibility path. Without it every row written before this change
    // reads as nothing.
    assert.equal(openText(NOTE), NOTE);
    assert.equal(openText("Subjective: client attended."), "Subjective: client attended.");
    assert.equal(openText("v1:looks:like:the-name-envelope"), "v1:looks:like:the-name-envelope");
  });

  test("prose that merely looks envelope-shaped is not eaten", () => {
    // `field.ts` uses `v1:`, short enough for a note to begin with. The marker
    // here is deliberately distinctive so a real note is never mistaken for a
    // corrupt envelope — which would be silent data loss.
    const tricky = "nfenc1 was discussed: see 1:2:3 ratio";
    assert.equal(openText(tricky), tricky);
    assert.equal(isSealed(tricky), false);
  });

  test("a tampered envelope returns null, never the ciphertext", () => {
    const sealed = sealText(NOTE);
    const parts = sealed.split(":");
    // Flip a character in the ciphertext. GCM authenticates, so this must fail
    // loudly rather than decrypt to something else.
    parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
    const tampered = parts.join(":");
    assert.equal(isSealed(tampered), true, "still envelope-shaped");
    assert.equal(openText(tampered), null, "must not hand back the ciphertext");
  });

  test("an envelope from another key returns null", () => {
    const sealed = sealText(NOTE);
    process.env.FIELD_ENCRYPTION_KEY = "a-different-key-0123456789abcdefghijklmnop";
    assert.equal(openText(sealed), null);
    process.env.FIELD_ENCRYPTION_KEY = KEY;
  });

  test("an envelope with no key at all returns null, not the envelope", () => {
    const sealed = sealText(NOTE);
    delete process.env.FIELD_ENCRYPTION_KEY;
    assert.equal(openText(sealed), null);
    process.env.FIELD_ENCRYPTION_KEY = KEY;
  });

  test("sealing without a key throws rather than storing plaintext", () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    assert.throws(() => sealText(NOTE), /FIELD_ENCRYPTION_KEY/);
    process.env.FIELD_ENCRYPTION_KEY = KEY;
  });

  test("survives a long note", () => {
    const long = NOTE.repeat(400);
    assert.equal(openText(sealText(long)), long);
  });
});

describe("sealing a JSON answer map", () => {
  const FIELDS = {
    subjective: "Reports low mood & poor sleep <5h",
    needsList: ["housing", "benefits_advice"],
    riskSuicidal: { level: "passive", note: "No plan. Safety plan reviewed." },
    encounterDate: null,
  };

  test("round trips the whole shape, not just strings", () => {
    const sealed = sealJson(FIELDS);
    assert.equal(isSealedJson(sealed), true);
    assert.deepEqual(openJson(sealed), FIELDS);
  });

  test("hides the field ids as well as the answers", () => {
    // Per-key encryption would leave the ids readable, and which questions were
    // answered is itself informative — "this encounter recorded a suicidal-risk
    // level" is a disclosure before you read the value.
    const sealed = JSON.stringify(sealJson(FIELDS));
    for (const key of ["subjective", "riskSuicidal", "needsList", "housing"]) {
      assert.ok(!sealed.includes(key), `${key} must not be readable`);
    }
  });

  test("a legacy plain object is returned unchanged", () => {
    assert.deepEqual(openJson(FIELDS), FIELDS);
    assert.deepEqual(openJson({}), {});
  });

  test("null and undefined read as an empty answer map", () => {
    // Every caller handles "this submission recorded nothing"; none of them
    // handle null where an object belongs.
    assert.deepEqual(openJson(null), {});
    assert.deepEqual(openJson(undefined), {});
  });

  test("an unopenable envelope reads as empty rather than throwing", () => {
    const sealed = sealJson(FIELDS);
    process.env.FIELD_ENCRYPTION_KEY = "a-different-key-0123456789abcdefghijklmnop";
    assert.deepEqual(openJson(sealed), {});
    process.env.FIELD_ENCRYPTION_KEY = KEY;
  });

  test("an array is not mistaken for a sealed object", () => {
    assert.equal(isSealedJson(["a", "b"]), false);
    assert.deepEqual(openJson(["a", "b"]), ["a", "b"]);
  });
});
