import "server-only";

import { PDFDocument, StandardFonts, PageSizes, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { TEMPLATES } from "@/lib/intake/templates";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import type { Discipline, SubmissionKind, TemplateKind } from "@prisma/client";

export interface SubmissionPdfData {
  practiceName: string;
  clientCode: string;
  clientInitials: string;
  birthYear: number | null;
  submittedBy: string;
  encounterDate: Date;
  createdAt: Date;
  kind: SubmissionKind;
  templateKind: TemplateKind;
  discipline: Discipline | null;
  fields: Record<string, unknown>;
  rawText: string;
  pages: Array<{
    pageNumber: number;
    verifiedText: string | null;
    ocrText: string | null;
  }>;
}

const NAVY = rgb(0.035, 0.15, 0.34);
const TEAL = rgb(0.02, 0.55, 0.65);
const ORANGE = rgb(1, 0.48, 0.03);
const INK = rgb(0.11, 0.14, 0.19);
const MUTED = rgb(0.38, 0.43, 0.51);
const RULE = rgb(0.86, 0.89, 0.93);
const PAPER = rgb(0.985, 0.99, 1);

/** Builds the handoff document without ever writing clinical text to disk. */
export async function renderSubmissionPdf(data: SubmissionPdfData): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  document.setTitle(`NoteForge source material — ${data.clientCode}`);
  document.setAuthor("NoteForge");
  document.setSubject("Source material for clinical note production");
  document.setCreator("NoteForge");
  document.setProducer("NoteForge");
  document.setCreationDate(new Date());

  let page = document.addPage(PageSizes.Letter);
  let y = drawHeader(page, bold, data.practiceName);

  const ensureRoom = (height: number) => {
    if (y - height >= 56) return;
    page = document.addPage(PageSizes.Letter);
    y = drawHeader(page, bold, data.practiceName);
  };

  const drawBlock = (title: string, text: string, warning = false) => {
    const safeTitle = pdfSafe(title);
    const paragraphs = pdfSafe(text).split(/\n+/).filter(Boolean);
    const lines = paragraphs.flatMap((paragraph, index) => [
      ...(index > 0 ? [""] : []),
      ...wrapText(paragraph, regular, 10.5, 504),
    ]);
    const height = 31 + Math.max(1, lines.length) * 15;
    // Keep a short section together when it fits on a page. A long section must
    // start in the space already available and flow naturally, otherwise one
    // large narrative leaves an almost-empty page behind it.
    ensureRoom(height <= 620 ? height : 60);

    page.drawText(safeTitle, {
      x: 54,
      y,
      size: 11,
      font: bold,
      color: warning ? ORANGE : NAVY,
    });
    y -= 19;
    for (const line of lines.length ? lines : ["Not provided."]) {
      if (y < 56) {
        page = document.addPage(PageSizes.Letter);
        y = drawHeader(page, bold, data.practiceName);
      }
      if (line) {
        page.drawText(line, { x: 54, y, size: 10.5, font: regular, color: INK });
      }
      y -= 15;
    }
    y -= 10;
  };

  page.drawRectangle({ x: 54, y: y - 86, width: 504, height: 86, color: PAPER, borderColor: RULE, borderWidth: 1 });
  page.drawText("SOURCE MATERIAL — NOT A COMPLETED OR SIGNED CLINICAL NOTE", {
    x: 70,
    y: y - 22,
    size: 9.5,
    font: bold,
    color: ORANGE,
  });
  const summary = [
    `Client code: ${pdfSafe(data.clientCode)}`,
    `Initials: ${pdfSafe(data.clientInitials || "Not recorded")}`,
    `Birth year: ${data.birthYear ?? "Not recorded"}`,
    `Encounter: ${isoDate(data.encounterDate)}`,
    `Submitted by: ${pdfSafe(data.submittedBy)}`,
    `Discipline: ${data.discipline ? DISCIPLINE_LABEL[data.discipline] : "Not recorded"}`,
  ];
  summary.forEach((line, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    page.drawText(line, {
      x: 70 + column * 250,
      y: y - 43 - row * 16,
      size: 9.5,
      font: regular,
      color: MUTED,
    });
  });
  y -= 108;

  drawBlock("Format", `${TEMPLATES[data.templateKind].name} · ${data.kind === "PHOTO" ? "Photographed source" : "Structured intake"}`);

  if (data.kind === "STRUCTURED") {
    for (const field of TEMPLATES[data.templateKind].fields) {
      const value = data.fields[field.id];
      drawBlock(field.label, typeof value === "string" && value.trim() ? value : "Not provided.");
    }
  } else if (data.pages.length > 0) {
    for (const sourcePage of data.pages) {
      const verified = sourcePage.verifiedText?.trim();
      const machine = sourcePage.ocrText?.trim();
      drawBlock(
        `Page ${sourcePage.pageNumber} — ${verified ? "verified transcript" : machine ? "machine transcript, not yet verified" : "awaiting transcription"}`,
        verified || machine || "No transcript is available yet. Refer to the original page in the authenticated NoteForge workspace.",
        !verified
      );
    }
  } else {
    drawBlock("Submitted context", data.rawText.trim() || "No transcript is available yet.", true);
  }

  const pages = document.getPages();
  pages.forEach((pdfPage, index) => {
    pdfPage.drawLine({ start: { x: 54, y: 38 }, end: { x: 558, y: 38 }, thickness: 0.6, color: RULE });
    pdfPage.drawText(`Generated ${isoDate(new Date())} · Page ${index + 1} of ${pages.length}`, {
      x: 54,
      y: 22,
      size: 8,
      font: regular,
      color: MUTED,
    });
    pdfPage.drawText("Keep confidential · Secure link expires", {
      x: 396,
      y: 22,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return document.save();
}

function drawHeader(page: PDFPage, bold: PDFFont, practiceName: string): number {
  page.drawRectangle({ x: 0, y: 744, width: 612, height: 48, color: NAVY });
  page.drawRectangle({ x: 0, y: 740, width: 612, height: 4, color: TEAL });
  page.drawText("NoteForge", { x: 54, y: 760, size: 17, font: bold, color: rgb(1, 1, 1) });
  const practice = truncate(pdfSafe(practiceName), bold, 9, 260);
  page.drawText(practice, { x: 558 - bold.widthOfTextAtSize(practice, 9), y: 763, size: 9, font: bold, color: rgb(0.82, 0.92, 0.95) });
  return 714;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(chunk + character, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let value = text;
  while (value && font.widthOfTextAtSize(`${value}...`, size) > maxWidth) value = value.slice(0, -1);
  return `${value}...`;
}

function pdfSafe(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
