/**
 * Seals the clinical text in rows written before column encryption existed.
 *
 * New writes are sealed by `submitEncounter` and `saveNote`. Everything already
 * in the database is plaintext, and `openText` passes it through unchanged so
 * the product keeps working — but a row that has not been through this script is
 * a row a leaked database credential still reads. That is the whole point of the
 * change, so the backfill is not optional, it is just deferrable.
 *
 * Run: npx tsx --conditions=react-server scripts/encrypt-existing-text.ts [--commit]
 *
 * Without `--commit` it reports what it would do and writes nothing.
 *
 * ## Why it is safe to run twice
 *
 * Every value is checked with `isSealed` / `isSealedJson` first, so an
 * already-encrypted row is skipped rather than double-wrapped. Double-wrapping
 * would still decrypt to *something* — a string containing an envelope — which
 * is the kind of corruption that looks fine until somebody reads a note. Being
 * idempotent is what makes it safe to re-run after a partial failure, which is
 * the situation this will actually be used in.
 *
 * ## Why it goes in batches and never in one transaction
 *
 * A single transaction over every submission in a real practice holds locks for
 * the length of the run and rolls the whole thing back on one bad row. Batches
 * mean an interrupted run leaves a database that is half sealed and entirely
 * readable — which is exactly what the pass-through in `openText` is for.
 */

import { PrismaClient } from "@prisma/client";
import {
  sealText,
  openText,
  isSealed,
  sealJson,
  openJson,
  isSealedJson,
} from "../src/lib/crypto/text";
import { columnCryptoConfigured } from "../src/lib/crypto/key";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");
const BATCH = 200;

interface Counts {
  scanned: number;
  sealed: number;
  already: number;
  empty: number;
}

const zero = (): Counts => ({ scanned: 0, sealed: 0, already: 0, empty: 0 });

function report(label: string, c: Counts) {
  console.log(
    `  ${label.padEnd(22)} scanned ${String(c.scanned).padStart(6)} · ` +
      `sealed ${String(c.sealed).padStart(6)} · ` +
      `already ${String(c.already).padStart(6)} · ` +
      `empty ${String(c.empty).padStart(6)}`
  );
}

async function submissions(): Promise<Counts> {
  const counts = zero();
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.submission.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, rawTextEnc: true, normalizedTextEnc: true, fieldsEnc: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      counts.scanned++;
      const data: Record<string, unknown> = {};

      if (row.rawTextEnc && !isSealed(row.rawTextEnc)) {
        data.rawTextEnc = sealText(row.rawTextEnc);
      }
      if (row.normalizedTextEnc && !isSealed(row.normalizedTextEnc)) {
        data.normalizedTextEnc = sealText(row.normalizedTextEnc);
      }
      // An empty object is not worth an envelope, and `{}` is what a photo
      // submission legitimately holds.
      const fields = row.fieldsEnc;
      if (!isSealedJson(fields) && fields && Object.keys(fields).length > 0) {
        data.fieldsEnc = sealJson(fields);
      }

      if (Object.keys(data).length === 0) {
        if (row.rawTextEnc && isSealed(row.rawTextEnc)) counts.already++;
        else counts.empty++;
        continue;
      }

      counts.sealed++;
      if (COMMIT) {
        await prisma.submission.update({ where: { id: row.id }, data });
      }
    }
  }
  return counts;
}

async function notes(): Promise<Counts> {
  const counts = zero();
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.note.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, bodyEnc: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      counts.scanned++;
      if (isSealedJson(row.bodyEnc)) {
        counts.already++;
        continue;
      }
      if (!row.bodyEnc || Object.keys(row.bodyEnc).length === 0) {
        counts.empty++;
        continue;
      }
      counts.sealed++;
      if (COMMIT) {
        await prisma.note.update({
          where: { id: row.id },
          data: { bodyEnc: sealJson(row.bodyEnc) as unknown as object },
        });
      }
    }
  }
  return counts;
}

async function pages(): Promise<Counts> {
  const counts = zero();
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.submissionPage.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, ocrTextEnc: true, verifiedTextEnc: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      counts.scanned++;
      const data: Record<string, unknown> = {};
      if (row.ocrTextEnc && !isSealed(row.ocrTextEnc)) {
        data.ocrTextEnc = sealText(row.ocrTextEnc);
      }
      if (row.verifiedTextEnc && !isSealed(row.verifiedTextEnc)) {
        data.verifiedTextEnc = sealText(row.verifiedTextEnc);
      }
      if (Object.keys(data).length === 0) {
        if (row.ocrTextEnc || row.verifiedTextEnc) counts.already++;
        else counts.empty++;
        continue;
      }
      counts.sealed++;
      if (COMMIT) {
        await prisma.submissionPage.update({ where: { id: row.id }, data });
      }
    }
  }
  return counts;
}

/**
 * The three tables that were nearly missed.
 *
 * `Client.statusReason`, `ClientStatusEvent.reason` and `SubmissionFlag.detail`
 * were all still plaintext after the obvious columns had been sealed, and were
 * found by `verify:at-rest` rather than by anybody's survey. They were then
 * nearly missed *again* here: a backfill that covers only the columns somebody
 * remembered leaves a database that passes every unit test and still hands a
 * clinical sentence to whoever reads the dump.
 */
async function statusReasons(): Promise<Counts> {
  const counts = zero();
  const clients = await prisma.client.findMany({
    where: { NOT: { statusReasonEnc: null } },
    select: { id: true, statusReasonEnc: true },
  });
  for (const row of clients) {
    counts.scanned++;
    if (!row.statusReasonEnc) { counts.empty++; continue; }
    if (isSealed(row.statusReasonEnc)) { counts.already++; continue; }
    counts.sealed++;
    if (COMMIT) {
      await prisma.client.update({
        where: { id: row.id },
        data: { statusReasonEnc: sealText(row.statusReasonEnc) },
      });
    }
  }
  return counts;
}

async function statusEvents(): Promise<Counts> {
  const counts = zero();
  const events = await prisma.clientStatusEvent.findMany({
    where: { NOT: { reasonEnc: null } },
    select: { id: true, reasonEnc: true },
  });
  for (const row of events) {
    counts.scanned++;
    if (!row.reasonEnc) { counts.empty++; continue; }
    if (isSealed(row.reasonEnc)) { counts.already++; continue; }
    counts.sealed++;
    if (COMMIT) {
      await prisma.clientStatusEvent.update({
        where: { id: row.id },
        data: { reasonEnc: sealText(row.reasonEnc) },
      });
    }
  }
  return counts;
}

async function flags(): Promise<Counts> {
  const counts = zero();
  const rows = await prisma.submissionFlag.findMany({
    where: { NOT: { detailEnc: null } },
    select: { id: true, detailEnc: true },
  });
  for (const row of rows) {
    counts.scanned++;
    if (!row.detailEnc) { counts.empty++; continue; }
    if (isSealed(row.detailEnc)) { counts.already++; continue; }
    counts.sealed++;
    if (COMMIT) {
      await prisma.submissionFlag.update({
        where: { id: row.id },
        data: { detailEnc: sealText(row.detailEnc) },
      });
    }
  }
  return counts;
}

async function main() {
  if (!columnCryptoConfigured()) {
    console.error(
      "FIELD_ENCRYPTION_KEY is not set (or is shorter than 32 characters).\n" +
        "Nothing was read and nothing was written."
    );
    process.exit(1);
  }

  console.log(
    COMMIT
      ? "Sealing clinical text in place.\n"
      : "Dry run — nothing will be written. Add --commit to apply.\n"
  );

  const s = await submissions();
  report("Submission", s);
  const n = await notes();
  report("Note", n);
  const p = await pages();
  report("SubmissionPage", p);
  const sr = await statusReasons();
  report("Client.statusReason", sr);
  const se = await statusEvents();
  report("ClientStatusEvent", se);
  const fl = await flags();
  report("SubmissionFlag", fl);

  const total = s.sealed + n.sealed + p.sealed + sr.sealed + se.sealed + fl.sealed;
  console.log(
    COMMIT
      ? `\nSealed ${total} row(s).`
      : `\n${total} row(s) would be sealed. Re-run with --commit.`
  );

  /*
   * A read-back, and only on a committed run.
   *
   * Writing ciphertext and never reading it back is how a backfill "succeeds"
   * against a key that cannot decrypt what it just wrote — the failure would
   * surface days later as notes that render empty. One row is enough to prove
   * the round trip against the key this process is actually holding.
   */
  if (COMMIT && total > 0) {
    const check = await prisma.submission.findFirst({
      where: { NOT: { rawTextEnc: "" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, rawTextEnc: true, fieldsEnc: true },
    });
    if (check) {
      const opened = openText(check.rawTextEnc);
      const fields = openJson(check.fieldsEnc);
      const ok = opened !== null && typeof fields === "object";
      console.log(
        ok
          ? `Read-back on ${check.id}: text and answers both decrypt.`
          : `READ-BACK FAILED on ${check.id} — the key cannot open what was just written.`
      );
      if (!ok) process.exit(1);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
