/**
 * Numbers, in both directions.
 *
 * `toE164` was already careful, because the bug it was written for — a national
 * number silently becoming a Russian one — reported success the whole way and
 * was only ever visible to the person who never received the message.
 *
 * `splitE164` is the same failure read backwards: a stored number put back into
 * a form has to land in the two boxes it came from, and when it did not, the
 * screen showed a Nigerian number beside a selector reading "+1". Nothing threw
 * and nothing failed a build. So both directions are asserted here, including
 * the round trip, which is the property that actually matters: whatever a
 * clinician saved must come back looking like what they saved.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toE164, splitE164, CALLING_CODES } from "@/lib/sharing/phone";

describe("splitE164", () => {
  test("takes a stored number apart into the two controls that made it", () => {
    assert.deepEqual(splitE164("+2348012345678"), { code: "234", national: "8012345678" });
    assert.deepEqual(splitE164("+447700900123"), { code: "44", national: "7700900123" });
    assert.deepEqual(splitE164("+15551234567"), { code: "1", national: "5551234567" });
  });

  test("prefers the longest matching code", () => {
    // +23 is not a country, but it is a prefix of both +234 and +233. Matching
    // shortest-first would put a Ghanaian number under Nigeria.
    assert.deepEqual(splitE164("+233201234567"), { code: "233", national: "201234567" });
    assert.deepEqual(splitE164("+237677123456"), { code: "237", national: "677123456" });
  });

  test("an empty value is an empty form, not a zero", () => {
    assert.deepEqual(splitE164(null), { code: "1", national: "" });
    assert.deepEqual(splitE164(undefined), { code: "1", national: "" });
    assert.deepEqual(splitE164("   "), { code: "1", national: "" });
  });

  test("an unlisted country keeps the whole number, where the + still wins", () => {
    // +672 is not in the short list. The national box then holds the full
    // international form, which `toE164` treats as authoritative — so it looks
    // less tidy and still sends to the right place.
    const split = splitE164("+6723456789");
    assert.equal(split.national, "+6723456789");
    assert.equal(toE164(split.national, split.code).ok, true);
  });

  test("round trips every offered country", () => {
    for (const { code } of CALLING_CODES) {
      const stored = `+${code}7005550123`;
      const split = splitE164(stored);
      const back = toE164(split.national, split.code);
      assert.equal(back.ok, true, `${code} must re-parse`);
      if (back.ok) {
        assert.equal(back.e164, stored, `${code} must survive the round trip`);
      }
    }
  });
});

describe("the country list the dropdown renders", () => {
  test("every entry has a label naming its country", () => {
    // The bug: the select rendered `+{code}`, so the list read "+1, +44, +237,
    // +234, +233 …" with nothing to say which country any of them was. The
    // labels existed the whole time and were simply not used.
    for (const entry of CALLING_CODES) {
      assert.ok(entry.label.length > 0, `${entry.code} needs a label`);
      assert.ok(
        entry.label.includes(`(+${entry.code})`),
        `${entry.label} must show its own code`
      );
      assert.ok(
        /[A-Za-z]/.test(entry.label.replace(/\(\+\d+\)/, "")),
        `${entry.label} must name a country, not just repeat the code`
      );
    }
  });

  test("no code appears twice", () => {
    const seen = new Set(CALLING_CODES.map((c) => c.code));
    assert.equal(seen.size, CALLING_CODES.length);
  });
});
