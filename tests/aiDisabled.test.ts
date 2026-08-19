/**
 * Does the off switch actually turn the vendor off?
 *
 * `docs/BAA.md` makes removing Moonshot the first step before any money is
 * spent on agreements: it receives photographed notes and full submission text,
 * and it signs no BAA. The advice originally given was "unset `KIMI_API_KEY`",
 * which is **wrong on its own** — two variable names are read, so a deployment
 * with `MOONSHOT_API_KEY` also set stays fully live while the operator believes
 * the vendor is gone. Nothing on any screen would have said otherwise.
 *
 * So the switch is asserted here rather than assumed, and asserted the way it
 * actually gets used: with a key present. A test that unsets everything and
 * then finds no key proves nothing about the control — it proves the absence of
 * a key, which was never in doubt.
 *
 * These are unit tests over the key resolver and every path that reaches it.
 * They need no database and no network: if a call *were* attempted the fake key
 * below would fail against a real endpoint, so a passing suite that reaches the
 * network would still fail — which is the property wanted.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  aiDisabled,
  kimiConfigured,
  kimiJson,
  kimiKeySource,
  KEY_VARIABLES,
  AI_DISABLE_VARIABLE,
} from "@/lib/ai/kimi";

const SAVED: Record<string, string | undefined> = {};
const TOUCHED = [...KEY_VARIABLES, AI_DISABLE_VARIABLE];

beforeEach(() => {
  for (const name of TOUCHED) {
    SAVED[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of TOUCHED) {
    if (SAVED[name] === undefined) delete process.env[name];
    else process.env[name] = SAVED[name];
  }
});

describe("the model-vendor off switch", () => {
  test("a key under either variable is live without it", () => {
    // The premise. If this ever fails, the tests below are vacuous.
    for (const variable of KEY_VARIABLES) {
      for (const other of KEY_VARIABLES) delete process.env[other];
      process.env[variable] = "sk-test-not-a-real-key";
      assert.equal(kimiConfigured(), true, `${variable} must be read`);
      assert.equal(kimiKeySource().variable, variable);
    }
  });

  test("beats a key under every variable at once", () => {
    // The exact shape of the trap: somebody unsets KIMI_API_KEY, and the
    // deployment keeps talking to Moonshot through the other name.
    for (const variable of KEY_VARIABLES) {
      process.env[variable] = "sk-test-not-a-real-key";
    }
    assert.equal(kimiConfigured(), true, "both keys set must be live to start with");

    process.env[AI_DISABLE_VARIABLE] = "1";
    assert.equal(aiDisabled(), true);
    assert.equal(kimiConfigured(), false, "the switch must beat every key");
    assert.equal(kimiKeySource().key, null, "no key may be resolved");
    assert.equal(kimiKeySource().variable, null);
    assert.equal(kimiKeySource().fingerprint, null, "not even four characters");
  });

  test("unsetting only one of the two variables does not turn it off", () => {
    // Stated as a test because it was stated as advice, and the advice was
    // incomplete. This is the assertion that makes the documentation honest.
    for (const variable of KEY_VARIABLES) {
      process.env[variable] = "sk-test-not-a-real-key";
    }
    delete process.env.KIMI_API_KEY;
    assert.equal(
      kimiConfigured(),
      true,
      "removing one key name leaves the vendor live — this is why the switch exists"
    );
  });

  test("every call returns null rather than reaching the network", async () => {
    for (const variable of KEY_VARIABLES) {
      process.env[variable] = "sk-test-not-a-real-key";
    }
    process.env[AI_DISABLE_VARIABLE] = "1";

    // `kimiJson` is the single chokepoint: readHandwriting, classifyPair and
    // draftNote all go through it, so proving this one returns null before
    // opening a socket covers all three.
    const probe = {
      schema: { type: "object", properties: {} },
      schemaName: "probe",
      scope: "test",
    };

    const text = await kimiJson({ system: "s", user: "clinical narrative", ...probe });
    assert.equal(text, null);

    const image = await kimiJson({
      system: "s",
      user: "a photographed note",
      imageDataUri: "data:image/png;base64,iVBORw0KGgo=",
      ...probe,
    });
    assert.equal(image, null, "a photographed note must not leave either");
  });

  test("accepts what somebody actually types into a dashboard field", () => {
    process.env.KIMI_API_KEY = "sk-test-not-a-real-key";
    for (const on of ["1", "true", "TRUE", "yes", " 1 "]) {
      process.env[AI_DISABLE_VARIABLE] = on;
      assert.equal(aiDisabled(), true, `${JSON.stringify(on)} must disable`);
    }
    for (const off of ["0", "false", "no", "", "  "]) {
      process.env[AI_DISABLE_VARIABLE] = off;
      assert.equal(aiDisabled(), false, `${JSON.stringify(off)} must not disable`);
      assert.equal(kimiConfigured(), true, `${JSON.stringify(off)} must leave the key live`);
    }
  });

  test("is off by default, so it can never silently disable a working deployment", () => {
    process.env.KIMI_API_KEY = "sk-test-not-a-real-key";
    delete process.env[AI_DISABLE_VARIABLE];
    assert.equal(aiDisabled(), false);
    assert.equal(kimiConfigured(), true);
  });
});
