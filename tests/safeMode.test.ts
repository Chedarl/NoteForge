/**
 * Safe mode, checked where it can actually be got around.
 *
 * The screens are the easy half: `identityOf` returns no name and every one of
 * them already falls back to initials, because a client with no name recorded
 * has always been possible. The half worth testing is the export, because the
 * export is reached by URL — `/api/export?names=1` — so a checkbox disabled in
 * a browser stops nobody who has seen an address bar. The override therefore
 * lives inside the function that builds the bundle, and that is what this
 * asserts.
 *
 * Against a real database, because the policy is read from a real row: a test
 * that handed `{ safeMode: true }` in by hand would prove only that an `if`
 * statement works.
 *
 * The archive is read by walking its own local file headers rather than by
 * trusting the builder's report — the same discipline as `export.test.ts`, and
 * for the same reason: the two export bugs this project has actually shipped
 * were both "the function ran and produced the wrong bytes".
 */

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { identityOf, labelOf, MATCH_ONLY, prepareName } from "@/lib/clients/identity";
import { displayPolicyFor } from "@/lib/clients/displayPolicy";
import { buildExport } from "@/lib/export/bundle";
import { submitEncounter } from "@/lib/intake/submit";
import { makeFixture, nursingFields, type Fixture } from "./_setup";

/** Distinctive enough that finding it anywhere in the archive is unambiguous. */
const GIVEN_NAME = "Wilhelmina";

let f: Fixture;

before(async () => {
  f = await makeFixture("SAFEMODE");

  // The fixture's client has initials only. Safe mode is about names, so this
  // one needs a real encrypted name to hide.
  const named = prepareName({ givenName: GIVEN_NAME, familyInitial: "Q" });
  await prisma.client.update({
    where: { id: f.active.id },
    data: { givenNameEnc: named.givenNameEnc, familyInitial: named.familyInitial },
  });

  const filed = await submitEncounter({
    practiceId: f.practice.id,
    clientId: f.active.id,
    submittedBy: f.therapist,
    templateKind: "NURSING",
    kind: "STRUCTURED",
    encounterDate: new Date(),
    fields: nursingFields("safemode"),
  });
  assert.equal(filed.ok, true, "the fixture submission must file");
});

after(async () => {
  await f.clean();
});

const setSafeMode = (safeMode: boolean) =>
  prisma.practice.update({ where: { id: f.practice.id }, data: { safeMode } });

const wholeRange = () => ({
  from: new Date(Date.now() - 400 * 864e5),
  to: new Date(Date.now() + 864e5),
});

describe("the display policy", () => {
  test("reads what the practice actually stores", async () => {
    await setSafeMode(false);
    assert.equal((await displayPolicyFor(f.practice.id)).safeMode, false);
  });

  test("a practice that cannot be found resolves to safe mode ON", async () => {
    // "I could not find out what this practice permits" must never print a
    // name. This is the direction the whole control depends on being right.
    assert.equal((await displayPolicyFor("no-such-practice-id")).safeMode, true);
  });
});

describe("identityOf", () => {
  test("off: the name is readable", async () => {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: f.active.id } });
    assert.equal(identityOf({ safeMode: false }, client).displayName, `${GIVEN_NAME} Q.`);
    assert.ok(labelOf({ safeMode: false }, client).includes(GIVEN_NAME));
  });

  test("on: the name is gone and the code carries the row", async () => {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: f.active.id } });
    const identity = identityOf({ safeMode: true }, client);
    assert.equal(identity.displayName, null);
    // Everything non-identifying is untouched: this is the fallback every
    // screen already renders, not a new empty state.
    assert.equal(identity.clientCode, client.clientCode);
    assert.equal(identity.initials, client.initials);
    assert.ok(labelOf({ safeMode: true }, client).includes(client.clientCode));
    assert.ok(!labelOf({ safeMode: true }, client).includes(GIVEN_NAME));
  });

  test("MATCH_ONLY still sees the name, because resolving is not displaying", async () => {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: f.active.id } });
    assert.equal(
      identityOf(MATCH_ONLY, client).displayName,
      `${GIVEN_NAME} Q.`,
      "name matching must keep working in safe mode, or a typed name creates a duplicate client"
    );
  });
});

describe("the export", () => {
  test("safe mode off: an explicit request for names is honoured", async () => {
    await setSafeMode(false);
    const bundle = await buildExport({
      practiceId: f.practice.id,
      clientIds: [f.active.id],
      ...wholeRange(),
      includeNames: true,
      includeBlocked: false,
    });
    const manifest = await readJsonFromZip(bundle.zip, "sessions.json");
    assert.equal(manifest.namesIncluded, true);
    assert.equal(manifest.clients[0].displayName, `${GIVEN_NAME} Q.`);
  });

  test("safe mode on: `names=1` is refused rather than obeyed", async () => {
    await setSafeMode(true);
    const bundle = await buildExport({
      practiceId: f.practice.id,
      clientIds: [f.active.id],
      ...wholeRange(),
      // Exactly what `/api/export?names=1` passes. The screen cannot be trusted
      // to have prevented this.
      includeNames: true,
      includeBlocked: false,
    });
    const manifest = await readJsonFromZip(bundle.zip, "sessions.json");
    assert.equal(manifest.namesIncluded, false, "the manifest must not claim names are in it");
    assert.equal(manifest.clients[0].displayName, null, "no name may reach the bundle");
    assert.equal(manifest.clients[0].clientCode, f.active.clientCode);
  });

  test("safe mode on: the name is nowhere in the archive's bytes", async () => {
    await setSafeMode(true);
    const bundle = await buildExport({
      practiceId: f.practice.id,
      clientIds: [f.active.id],
      ...wholeRange(),
      includeNames: true,
      includeBlocked: false,
    });
    // The README and the per-session Markdown are written by separate code
    // paths from the manifest, and either could carry a name the manifest does
    // not. Searching the raw archive is the only assertion that covers all of
    // them — including any file added later.
    assert.ok(
      !(await containsText(bundle.zip, GIVEN_NAME)),
      `"${GIVEN_NAME}" appears somewhere in the export despite safe mode`
    );
    assert.ok(
      await containsText(bundle.zip, f.active.clientCode),
      "the client code must still identify every record"
    );
  });
});

/**
 * Pull one file out of the archive without a zip library.
 *
 * Walks the local file headers and inflates, which is what any real consumer
 * does. Reading it back with the writer's own assumptions would only prove the
 * bundle is self-consistent.
 */
async function readJsonFromZip(zip: Buffer, name: string) {
  const { inflateRawSync } = await import("zlib");
  let offset = 0;
  while (offset < zip.length - 4) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
      continue;
    }
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const entryName = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    if (entryName === name) {
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      const text = method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8");
      return JSON.parse(text);
    }
    offset = dataStart + compressedSize;
  }
  throw new Error(`${name} is not in the archive`);
}

/** Every entry inflated and searched — deflated bytes hide plaintext. */
async function containsText(zip: Buffer, needle: string): Promise<boolean> {
  const { inflateRawSync } = await import("zlib");
  let offset = 0;
  while (offset < zip.length - 4) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
      continue;
    }
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const entryName = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    let text: string;
    try {
      text = method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8");
    } catch {
      text = "";
    }
    if (entryName.includes(needle) || text.includes(needle)) return true;
    offset = dataStart + compressedSize;
  }
  return false;
}
