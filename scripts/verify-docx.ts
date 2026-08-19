/**
 * Is the Word document this produces a file Word will actually open?
 *
 * A `.docx` fails in exactly the way this project keeps being bitten by: the
 * build is green, the ZIP is written, the bytes are the right length — and the
 * file opens as "corrupt" with nothing to say which of five parts is wrong. So
 * this unzips the result, checks every part, and asserts the structure Word
 * requires rather than the structure this writer happens to emit.
 *
 * Run: npx tsx --conditions=react-server scripts/verify-docx.ts
 */
import { inflateRawSync } from "zlib";
import { renderDocx, type DocxBlock } from "../src/lib/export/docx";

/** The illegal-in-XML control character, kept as an escape so it survives editors. */
const CONTROL = "";

function entries(zip: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let offset = 0;
  while (offset < zip.length - 4) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
      continue;
    }
    const method = zip.readUInt16LE(offset + 8);
    const size = zip.readUInt32LE(offset + 18);
    const nameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const start = offset + 30 + nameLen + extraLen;
    const data = zip.subarray(start, start + size);
    out.set(name, method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8"));
    offset = start + size;
  }
  return out;
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * A deliberately hostile document.
 *
 * Every one of these has broken a hand-written OOXML writer somewhere: the
 * ampersand and the angle bracket are fatal parse errors if they reach the XML
 * unescaped, the newline silently collapses a paragraph onto one line, and the
 * control character is illegal in XML 1.0 with no escape that makes it legal —
 * and it arrives in real data, out of OCR.
 */
const blocks: DocxBlock[] = [
  { kind: "heading", level: 1, text: "RVN-0142 — Amara M." },
  { kind: "field", label: "Session date", value: "2026-08-01" },
  { kind: "note", text: "This client is On hold — travelling & unreachable." },
  { kind: "heading", level: 2, text: "Assessment" },
  { kind: "para", text: "BP 120/80 & stable.\nDrinks <2 units daily.\nNo SI/HI." },
  { kind: "para", text: `Quote: "doing better"${CONTROL} said twice` },
  { kind: "spacer" },
];

const buf = renderDocx(blocks);
const parts = entries(buf);

console.log(`docx: ${buf.length} bytes, ${parts.size} parts`);

for (const required of [
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
  "word/styles.xml",
  "word/_rels/document.xml.rels",
]) {
  check(`part present: ${required}`, parts.has(required));
}

check("[Content_Types].xml is the first entry", [...parts.keys()][0] === "[Content_Types].xml");

for (const [name, text] of parts) {
  if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;

  // No raw `&` that is not the start of an entity, and no raw `<` that is not
  // the start of a tag. These are the two that make the file unopenable, and
  // they are checkable without a parser.
  check(`no unescaped ampersand: ${name}`, !/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(text));

  // Tags balance. Crude, but it catches a dropped closing tag — the other way a
  // hand-written writer produces a file Word calls corrupt.
  //
  // The XML declaration is deliberately *not* subtracted: `<?xml` starts with
  // `<?`, which the opening-tag pattern below does not match in the first place.
  // Subtracting it made every part fail this check while the documents were
  // perfectly well-formed, which is a reminder that a failing assertion is as
  // likely to be wrong as the thing it is asserting about.
  //
  // `/>` cannot appear inside text, because `esc` turns every `>` into `&gt;`.
  const open = (text.match(/<[a-zA-Z[]/g) ?? []).length;
  const close = (text.match(/<\/[a-zA-Z]/g) ?? []).length;
  const selfClose = (text.match(/\/>/g) ?? []).length;
  check(
    `tags balance: ${name}`,
    open - selfClose === close,
    `open=${open} close=${close} self=${selfClose}`
  );

  check(`no illegal control characters: ${name}`, !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text));
}

const doc = parts.get("word/document.xml") ?? "";
check("the ampersand survived as an entity", doc.includes("120/80 &amp; stable"));
check("the angle bracket survived as an entity", doc.includes("&lt;2 units daily"));
check("newlines became explicit breaks", (doc.match(/<w:br\/>/g) ?? []).length >= 2);
check("the illegal control character was dropped", !doc.includes(CONTROL));
check("the quote is intact", doc.includes("&quot;doing better&quot;"));
check("headings use styles Word knows", doc.includes('w:pStyle w:val="Heading1"'));
check("a section is declared", doc.includes("<w:sectPr>"));
check("no literal newline inside a text run", !/<w:t[^>]*>[^<]*\n[^<]*<\/w:t>/.test(doc));

// The relationships have to point at parts that exist, or Word reports the file
// as corrupt without saying which link is dangling.
check(
  "styles are related from the document",
  (parts.get("word/_rels/document.xml.rels") ?? "").includes('Target="styles.xml"')
);
check(
  "the document is related from the package root",
  (parts.get("_rels/.rels") ?? "").includes('Target="word/document.xml"')
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed — Word would refuse this file.`);
  process.exit(1);
}
console.log("\nThe document is structurally what Word expects.");
