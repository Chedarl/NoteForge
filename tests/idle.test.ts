/**
 * The idle timeout, and the three ways it could fail open.
 *
 * A control like this is easy to write and easy to write uselessly: a cookie is
 * client-controlled, so an unsigned timestamp can simply be pinned, and a
 * "cannot tell" that resolves to "still fresh" is the same as having no timeout
 * at all.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  idleTimeoutMinutes,
  minutesSinceSeen,
  stampIdleCookie,
} from "@/lib/auth/idle";

const SECRET = "test-only-idle-secret-0123456789abcdef";

describe("the idle stamp", () => {
  test("a fresh stamp reads as no time passed", async () => {
    const value = await stampIdleCookie(SECRET);
    const minutes = await minutesSinceSeen(value, SECRET);
    assert.notEqual(minutes, null);
    assert.ok(minutes! < 1.1, `expected roughly zero, got ${minutes}`);
  });

  test("an old stamp reads as old", async () => {
    const minute = String(Math.floor(Date.now() / 60_000) - 45);
    // Signed correctly, just from 45 minutes ago — the honest case this exists
    // to catch.
    const forged = await stampIdleCookie(SECRET);
    const mac = forged.split(".")[1];
    void mac;
    // Build a genuine old stamp by signing the old minute the same way.
    const { createHmac } = await import("crypto");
    const sig = createHmac("sha256", SECRET)
      .update(`idle:${minute}`)
      .digest("hex")
      .slice(0, 16);
    const minutes = await minutesSinceSeen(`${minute}.${sig}`, SECRET);
    assert.ok(minutes !== null && minutes > 44 && minutes < 46, `got ${minutes}`);
  });

  /*
   * The one that matters. Without a signature anybody could hold a session open
   * forever by pinning the cookie to the current minute, and the whole control
   * would be decorative.
   */
  test("a tampered timestamp does not verify", async () => {
    const value = await stampIdleCookie(SECRET);
    const [, mac] = value.split(".");
    const pinned = `${Math.floor(Date.now() / 60_000)}.${mac}`;
    // Same minute, so this one happens to be valid — proving the setup works.
    assert.notEqual(await minutesSinceSeen(pinned, SECRET), null);

    // Now move the minute without re-signing, which is what an attacker does.
    const moved = `${Math.floor(Date.now() / 60_000) + 500}.${mac}`;
    assert.equal(
      await minutesSinceSeen(moved, SECRET),
      null,
      "a re-dated stamp must not verify"
    );
  });

  test("another deployment's secret does not verify", async () => {
    const value = await stampIdleCookie(SECRET);
    assert.equal(await minutesSinceSeen(value, "a-different-secret-entirely"), null);
  });

  test("junk and absence both read as unknown, never as fresh", async () => {
    for (const bad of [undefined, "", "not-a-stamp", "abc.def", "12345", "."]) {
      assert.equal(await minutesSinceSeen(bad, SECRET), null, `for ${JSON.stringify(bad)}`);
    }
  });

  /*
   * A stamp from the future is a clock change, or a forgery that happens to
   * verify against a rolled-back clock. Treating it as freshness would let it
   * extend a session; unknown means the caller writes a new stamp instead.
   */
  test("a future stamp is unknown, not fresh", async () => {
    const { createHmac } = await import("crypto");
    const future = String(Math.floor(Date.now() / 60_000) + 120);
    const sig = createHmac("sha256", SECRET)
      .update(`idle:${future}`)
      .digest("hex")
      .slice(0, 16);
    assert.equal(await minutesSinceSeen(`${future}.${sig}`, SECRET), null);
  });
});

describe("the configured window", () => {
  test("it defaults to half an hour", () => {
    delete process.env.SESSION_IDLE_MINUTES;
    assert.equal(idleTimeoutMinutes(), 30);
  });

  test("a nonsensical setting cannot make the product unusable", () => {
    // Floor and ceiling both matter: a zero would sign somebody out mid-form,
    // and a year is not a timeout, it is a cookie.
    process.env.SESSION_IDLE_MINUTES = "0";
    assert.equal(idleTimeoutMinutes(), 5);
    process.env.SESSION_IDLE_MINUTES = "999999";
    assert.equal(idleTimeoutMinutes(), 720);
    process.env.SESSION_IDLE_MINUTES = "banana";
    assert.equal(idleTimeoutMinutes(), 30);
    delete process.env.SESSION_IDLE_MINUTES;
  });
});
