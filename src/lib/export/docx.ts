import "server-only";

import { createZip } from "@/lib/export/zip";

/**
 * A minimal `.docx` writer.
 *
 * ## Why this exists
 *
 * The export handed note writers Markdown. A note writer opens a file, reads
 * it, and types a clinical note into Credible or ICANotes — and `## Assessment`
 * with `**bold**` scattered through it is not something you read, it is
 * something you decode. They asked for Word, and they are right: the export
 * exists for them, and a format they have to translate first is a format that
 * costs them time on every single session.
 *
 * ## Why by hand rather than a package
 *
 * The same argument the ZIP writer in this directory already makes, and this
 * builds directly on it: a `.docx` *is* a ZIP of XML. Adding a document-generation
 * dependency to a serverless function that handles clinical text buys a large
 * maintained surface for a subset that is entirely mechanical — headings,
 * paragraphs, bold runs, and a page size. OOXML has not moved in a way that
 * affects any of that since 2007.
 *
 * Deliberately limited: no images, no tables, no numbering, no footnotes, no
 * headers or footers. If the export ever needs a table, that is a real addition
 * and worth writing on purpose rather than inheriting.
 *
 * ## The two things that make Word refuse to open a file
 *
 * 1. **A missing or wrong part.** Word wants `[Content_Types].xml` at the root
 *    declaring every part, `_rels/.rels` pointing at the main document, and
 *    `word/_rels/document.xml.rels` pointing at the styles. Omit any one and it
 *    reports the file as corrupt with no indication which part is missing.
 * 2. **A raw `&` or `<` in text.** Clinical prose contains both — "BP 120/80 &
 *    stable", "<2 units daily" — and an unescaped one is not a rendering bug, it
 *    is a fatal XML parse error, so the whole document fails to open. Every
 *    string goes through `esc` for that reason, including the ones that look
 *    like they cannot contain markup.
 */

/** One block of a document. Deliberately few kinds. */
export type DocxBlock =
  | { kind: "heading"; level: 1 | 2; text: string }
  | { kind: "para"; text: string }
  /** "Session date: 2026-08-01" — the label bold, the value not. */
  | { kind: "field"; label: string; value: string }
  /** A callout. Rendered as an indented italic paragraph, not a table. */
  | { kind: "note"; text: string }
  | { kind: "spacer" };

/**
 * XML-escapes text, and strips what Word will not accept at all.
 *
 * Control characters below 0x20 (other than tab, newline, carriage return) are
 * illegal in XML 1.0 outright — no escaping makes them valid — and they do turn
 * up in text that has been through OCR. Dropping them here is the difference
 * between a file that opens and a file that does not.
 */
function esc(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One `<w:r>` run, with the line breaks preserved.
 *
 * `xml:space="preserve"` matters: without it Word collapses leading and
 * trailing whitespace, and a clinician's indented list loses its shape. Newlines
 * become explicit `<w:br/>` because OOXML has no concept of a literal newline
 * inside a text run — leave them in and the whole paragraph renders as one line.
 */
function run(text: string, opts: { bold?: boolean; italic?: boolean } = {}): string {
  const props =
    opts.bold || opts.italic
      ? `<w:rPr>${opts.bold ? "<w:b/>" : ""}${opts.italic ? "<w:i/>" : ""}</w:rPr>`
      : "";
  const parts = text.split(/\r?\n/);
  const body = parts
    .map((part, i) => `${i > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(part)}</w:t>`)
    .join("");
  return `<w:r>${props}${body}</w:r>`;
}

function para(inner: string, style?: string, indent = false): string {
  const props =
    style || indent
      ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${
          indent ? '<w:ind w:left="360"/>' : ""
        }</w:pPr>`
      : "";
  return `<w:p>${props}${inner}</w:p>`;
}

function blockToXml(block: DocxBlock): string {
  switch (block.kind) {
    case "heading":
      return para(run(block.text), block.level === 1 ? "Heading1" : "Heading2");
    case "para":
      return para(run(block.text));
    case "field":
      return para(`${run(`${block.label}: `, { bold: true })}${run(block.value)}`);
    case "note":
      return para(run(block.text, { italic: true }), undefined, true);
    case "spacer":
      return para("");
  }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/**
 * Styles.
 *
 * Sizes are in half-points, so `w:sz w:val="22"` is 11pt. Calibri, because it is
 * the one face present on every Windows and Mac install a note writer will open
 * this on — a missing font is silently substituted and the line breaks move.
 *
 * `Heading1` and `Heading2` are given `w:styleId`s Word recognises, so the
 * navigation pane populates and a long client folder can be skimmed.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/>
</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F3B3F"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="240" w:after="60"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="087F8C"/></w:rPr></w:style>
</w:styles>`;

/** Builds a `.docx` from blocks. Returns the file's bytes. */
export function renderDocx(blocks: DocxBlock[]): Buffer {
  const body = blocks.map(blockToXml).join("");

  // A4 at 1440 twips to the inch, with one-inch margins. `w:sectPr` is required
  // — a body without one opens, but Word rewrites the file on first save and
  // some readers refuse it outright.
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  // `[Content_Types].xml` first. Not strictly required by the specification, but
  // several readers assume it and it costs nothing to be conservative about the
  // one part whose absence makes the file unopenable.
  return createZip([
    { path: "[Content_Types].xml", content: CONTENT_TYPES },
    { path: "_rels/.rels", content: ROOT_RELS },
    { path: "word/_rels/document.xml.rels", content: DOCUMENT_RELS },
    { path: "word/styles.xml", content: STYLES },
    { path: "word/document.xml", content: document },
  ]);
}
