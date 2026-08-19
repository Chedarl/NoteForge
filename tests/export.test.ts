/**
 * The export, and the completeness gate that guards signing.
 *
 * Two real bugs shipped here, and both passed a type check and a build while
 * every exported section read "not recorded". That is the whole reason this
 * file asserts on *content* — the bytes a note writer actually opens — rather
 * than on whether a function was called.
 *
 * The other half is `assessCompleteness`, which is load-bearing in a way that
 * is easy to miss: it gates intake **and** it gates signing. A field it gets
 * wrong does not produce a warning, it produces a note that cannot be signed
 * and a specialist who cannot see why.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { submitEncounter } from "@/lib/intake/submit";
import { buildExport } from "@/lib/export/bundle";
import { summariseChanges } from "@/lib/export/changes";
import { assessCompleteness, encounterTypeOf, TEMPLATES } from "@/lib/intake/templates";
import { prisma } from "@/lib/prisma";
import { sealText } from "@/lib/crypto/text";
import { makeFixture, nursingFields, type Fixture } from "./_setup";

let f: Fixture;

before(async () => {
  f = await makeFixture("export");
});
after(async () => {
  await f.clean();
});

describe("completeness", () => {
  const complete = nursingFields("complete");

  test("a filled nursing encounter is complete", () => {
    assert.equal(assessCompleteness("NURSING", complete).complete, true);
  });

  test("an empty required field is named, not merely counted", () => {
    const { complete: ok, missing } = assessCompleteness("NURSING", {
      ...complete,
      medication: "",
    });
    assert.equal(ok, false);
    assert.ok(
      missing.includes("Medication"),
      "the gate has to say which field, or the clinician cannot act on it"
    );
  });

  test("a placeholder is not an answer", () => {
    const { complete: ok } = assessCompleteness("NURSING", { ...complete, plan: "ok" });
    assert.equal(ok, false, "two characters is a keystroke, not a record");
  });

  /*
   * A dropdown's answer is an option id, and ids are short. Gating one on the
   * eight-character floor that is right for prose would make the encounter-type
   * field permanently incomplete — which blocks *signing the note*, not just
   * submitting the form.
   */
  test("a short choice answer still counts as answered", () => {
    const { complete: ok, missing } = assessCompleteness("NURSING", {
      ...complete,
      encounterType: "crisis",
    });
    assert.equal(ok, true, `unexpectedly incomplete: ${missing.join(", ")}`);
  });

  test("a required field made required later does not reach backwards", () => {
    // `sinceLastContact` carries a `since` date. An encounter from before it
    // must not be marked incomplete, or the mean-completeness figure on the
    // dashboard collapses overnight and old notes stop being signable.
    const withoutIt = { ...complete, sinceLastContact: "" };
    const old = new Date("2026-01-05");

    assert.equal(assessCompleteness("NURSING", withoutIt, old).complete, true);
    assert.equal(assessCompleteness("NURSING", withoutIt, new Date()).complete, false);
  });

  test("every template can be completed at all", () => {
    // A template whose required set cannot be satisfied is a note that can
    // never be signed, and nothing else in the system would say so.
    for (const [kind, template] of Object.entries(TEMPLATES)) {
      const answers: Record<string, unknown> = {};
      for (const field of template.fields) {
        const type = field.type ?? "prose";
        if (type === "multi") answers[field.id] = ["anything"];
        else if (type === "severity") answers[field.id] = { level: "none", note: "" };
        else if (type === "choice") answers[field.id] = field.options?.[0]?.id ?? "";
        else answers[field.id] = "A sentence long enough to count as a record.";
      }
      const { complete, missing } = assessCompleteness(kind as keyof typeof TEMPLATES, answers);
      assert.equal(complete, true, `${kind} cannot be completed: ${missing.join(", ")}`);
    }
  });
});

describe("the encounter type that names the exported file", () => {
  test("it is what the clinician chose, not the template", () => {
    assert.equal(
      encounterTypeOf("NURSING", { ...nursingFields("x"), encounterType: "crisis" }),
      "Crisis"
    );
  });

  test("it falls back to the template name when there is none", () => {
    // The one-box narrative, and every submission filed before the field
    // existed. Neither may produce an empty filename segment.
    assert.equal(encounterTypeOf("NARRATIVE", { narrative: "x" }), "Narrative");
    assert.equal(encounterTypeOf("NURSING", { presentation: "x" }), "Nursing encounter");
  });
});

describe("the ZIP bundle", () => {
  test("it carries every answer, keyed by field id and rendered as text", async () => {
    const filed = await submitEncounter({
      practiceId: f.practice.id,
      clientId: f.active.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NURSING",
      encounterDate: new Date(),
      fields: {
        ...nursingFields("bundle"),
        symptoms: ["sleep", "appetite"],
        riskSuicidal: { level: "passive", note: "No plan, safety plan reviewed." },
      },
    });
    assert.equal(filed.ok, true);

    const bundle = await buildExport({
      practiceId: f.practice.id,
      clientIds: [f.active.id],
      from: new Date(Date.now() - 400 * 864e5),
      to: new Date(Date.now() + 864e5),
      includeNames: false,
      includeBlocked: false,
    });

    assert.ok(bundle.zip.length > 0);
    assert.equal(bundle.sessionCount, 1);

    // Read the archive's own bytes rather than trusting the builder's report.
    // This is the check that would have caught "not recorded" everywhere.
    const raw = bundle.zip.toString("latin1");
    assert.ok(raw.includes("sessions.json"), "the machine-readable file must be in the archive");

    const sessions = await readJsonFromZip(bundle.zip, "sessions.json");
    const session = sessions.clients[0].sessions[0];

    assert.equal(session.fields.encounterType, "Clinical follow-up", "labels, never ids");
    assert.equal(session.fields.symptoms, "Sleep, Appetite", "a picker renders as its labels");
    assert.ok(
      String(session.fields.riskSuicidal).includes("Passive"),
      "a severity renders as level and note"
    );
    assert.ok(!JSON.stringify(session.fields).includes("[object Object]"));
    assert.ok(!JSON.stringify(session.fields).includes("not recorded"));

    // Names are off unless asked for, and the code always identifies.
    assert.equal(sessions.namesIncluded, false);
    assert.equal(sessions.clients[0].displayName, null);
    assert.equal(sessions.clients[0].clientCode, f.active.clientCode);
  });

  test("a refused submission stays out of the export unless asked for", async () => {
    const blocked = await prisma.client.create({
      data: {
        practiceId: f.practice.id,
        clientCode: `${f.practice.code}-BLK`,
        initials: "B.K.",
        status: "DISCHARGED",
        statusReasonEnc: sealText("For the export test"),
        primaryTherapistId: f.therapist.id,
      },
    });
    await submitEncounter({
      practiceId: f.practice.id,
      clientId: blocked.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NARRATIVE",
      encounterDate: new Date(),
      fields: { narrative: "Refused material that must not reach a note writer by default." },
    });

    const bundle = await buildExport({
      practiceId: f.practice.id,
      clientIds: [blocked.id],
      from: new Date(Date.now() - 400 * 864e5),
      to: new Date(Date.now() + 864e5),
      includeNames: false,
      includeBlocked: false,
    });

    assert.ok(
      !bundle.zip.toString("latin1").includes("must not reach a note writer"),
      "a refused submission is kept for reconciliation, not handed to production"
    );
  });
});

describe("what changed since last time", () => {
  test("the clinician's own sentence leads, and is not repeated in the comparison", async () => {
    const client = await prisma.client.create({
      data: {
        practiceId: f.practice.id,
        clientCode: `${f.practice.code}-CHG`,
        initials: "C.G.",
        status: "ACTIVE",
        primaryTherapistId: f.therapist.id,
      },
    });

    await submitEncounter({
      practiceId: f.practice.id,
      clientId: client.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NURSING",
      encounterDate: new Date(Date.now() - 30 * 864e5),
      fields: { ...nursingFields("earlier"), riskSuicidal: { level: "none", note: "" } },
    });

    const latest = await submitEncounter({
      practiceId: f.practice.id,
      clientId: client.id,
      submittedBy: f.therapist,
      kind: "STRUCTURED",
      templateKind: "NURSING",
      encounterDate: new Date(),
      fields: {
        ...nursingFields("later"),
        sinceLastContact: "Rang the service overnight, the thoughts came back.",
        riskSuicidal: { level: "active_with_plan", note: "Crisis team attended." },
      },
    });
    assert.equal(latest.ok, true);
    if (!latest.ok) return;

    const row = await prisma.submission.findUniqueOrThrow({ where: { id: latest.submissionId } });
    const changes = await summariseChanges(row);

    assert.equal(changes.comparable, true, "two nursing encounters must compare");
    assert.ok(
      changes.clinicianStatement?.startsWith("Rang the service overnight"),
      "the clinician's own account is the statement"
    );
    assert.ok(
      !changes.fields.some((field) => field.fieldId === "sinceLastContact"),
      "and it must not also appear in the derived list under itself"
    );
    assert.equal(
      changes.fields.find((field) => field.fieldId === "riskSuicidal")?.status,
      "changed",
      "a severity moving must read as a change, not as unchanged"
    );
  });
});

/**
 * Pull one file out of the archive without a zip library.
 *
 * The bundle is written by this project's own dependency-free zip writer, and
 * reading it back with the same assumptions would only prove it is
 * self-consistent. This walks the local file headers and inflates, which is
 * what any real consumer does.
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
