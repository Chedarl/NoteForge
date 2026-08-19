/**
 * The email that carries a share link.
 *
 * Two things are asserted, and both are about what must *not* be in the
 * message. `send.ts` rule 1 is that nothing clinical leaves in an email and
 * every message is a pointer — but a rule in a comment is not a control, and
 * the obvious way to break this one is for somebody to add a client code to the
 * subject line so the recipient knows what they are being sent. A subject shows
 * on a lock screen; "RVN-0142" beside a clinical service is an identifier.
 *
 * The passcode is the other one. Emailing the code alongside the link would
 * make the lock decorative, and it is exactly the shortcut a well-meaning
 * change would take to save the sender a phone call.
 *
 * No database and no network: `emailShareLink` is given no key, so it refuses
 * and reports why, which is itself the third thing worth asserting — a silent
 * false there is how a note writer never receives something everybody believes
 * was sent.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { looksLikeEmail, emailShareLink, composeShareEmail } from "@/lib/sharing/email";

const KEY = "RESEND_API_KEY";
const FROM = "EMAIL_FROM";
let savedKey: string | undefined;
let savedFrom: string | undefined;

before(() => {
  savedKey = process.env[KEY];
  savedFrom = process.env[FROM];
});

after(() => {
  if (savedKey === undefined) delete process.env[KEY];
  else process.env[KEY] = savedKey;
  if (savedFrom === undefined) delete process.env[FROM];
  else process.env[FROM] = savedFrom;
});

const share = {
  downloadUrl: "https://noteforge.example/share/abc123",
  ttlHours: 48,
  senderName: "Priya Raman",
  practiceName: "Riverbend Therapy Associates",
};

describe("looksLikeEmail", () => {
  test("accepts an ordinary address", () => {
    assert.equal(looksLikeEmail("notes@practice.com"), true);
    assert.equal(looksLikeEmail("  first.last+tag@sub.example.co.uk  "), true);
  });

  test("refuses what would fail at the API anyway", () => {
    for (const bad of ["", "   ", "nobody", "no@domain", "a@b", "two @spaces.com", "@x.com"]) {
      assert.equal(looksLikeEmail(bad), false, `"${bad}" should be refused`);
    }
  });

  test("refuses an address longer than the RFC allows", () => {
    assert.equal(looksLikeEmail(`${"a".repeat(250)}@x.com`), false);
  });
});

describe("emailShareLink", () => {
  test("refuses a bad address before touching the mail API", async () => {
    const result = await emailShareLink({ to: "nobody", locked: true, ...share });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /does not look right/i);
  });

  test("says so out loud when email is not configured", async () => {
    delete process.env[KEY];
    delete process.env[FROM];
    const result = await emailShareLink({ to: "notes@practice.com", locked: true, ...share });
    assert.equal(result.ok, false);
    // The sender is standing at a screen believing they just delivered
    // something. A quiet false here is how nobody finds out.
    assert.match(result.error ?? "", /not configured/i);
    assert.match(result.error ?? "", /WhatsApp|copy the link/i);
  });
});

describe("what the message may contain", () => {
  // The real composer, not a copy of it. A test that rebuilds the string it is
  // checking passes whatever the function later does, which is precisely the
  // blind spot these assertions exist to close.
  const locked = composeShareEmail({ locked: true, ...share });
  const open = composeShareEmail({ locked: false, ...share });

  test("carries the link", () => {
    assert.ok(locked.text.includes(share.downloadUrl), "the link is the whole point");
    assert.ok(open.text.includes(share.downloadUrl));
  });

  test("carries no client identifier, in the body or the subject", () => {
    for (const [where, value] of [
      ["body", locked.text],
      ["subject", locked.subject],
    ] as const) {
      // A practice code prefix identifies a client, and a subject line shows on
      // a lock screen.
      assert.ok(!/\b[A-Z]{2,5}-\d{3,}\b/.test(value), `no client code may appear in the ${where}`);
      assert.ok(!/\bDOB\b/i.test(value), `no date of birth in the ${where}`);
    }
  });

  test("never carries six digits that could be the passcode", () => {
    assert.ok(
      !/\b\d{6}\b/.test(locked.text),
      "a six-digit run in the body would defeat the lock the link is behind"
    );
    assert.match(locked.text, /not in this email/i, "and it must say where the code is not");
  });

  test("an unlocked link says nothing about a code at all", () => {
    assert.ok(!/code/i.test(open.text), "mentioning a code nobody will be asked for is confusing");
  });

  test("tells an unexpecting recipient what to do", () => {
    // A bare URL arriving unannounced reads as phishing, and a note writer who
    // is unsure simply does not open it.
    assert.match(locked.text, /not expecting this/i);
  });

  test("says plainly that it holds no patient information", () => {
    assert.match(locked.text, /No patient information/i);
  });
});
