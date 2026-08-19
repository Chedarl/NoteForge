/**
 * Does any clinical document still leave as bytes rather than as a link?
 *
 * The WhatsApp handoff was hardened by replacing `sendDocument` with a
 * tokenised, expiring link on every path — except that it was not every path.
 * `src/lib/clients/roster.ts` was missed, so on any deployment with the Cloud
 * API configured a clinician's **entire caseload** — every client code, every
 * status including "Deceased", every last-session date, and their first names
 * whenever the box was ticked — was pushed to Meta as an attachment and left
 * permanently in a chat history and its phone backup.
 *
 * Nothing caught it. Lint, typecheck, build and every test were green, both
 * `CLAUDE.md` and `SECURITY.md` asserted the migration was complete, and the
 * call site sat two lines above the code that made the link it was supposed to
 * have been replaced by. It was found while writing a document that repeated
 * the same false claim.
 *
 * So the claim is a check now. `sendDocument` stays in the codebase — it is a
 * working Cloud API implementation and deleting it would lose that — but it must
 * have no callers.
 *
 * Run: npm run verify:handoff
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = "src";

/** Every .ts/.tsx under src, excluding the module that defines the function. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Strips comments before searching.
 *
 * Both `roster.ts` and `sharing/email.ts` now *explain* why `sendDocument` is
 * not used, and a naive grep counts those explanations as violations — which
 * would make the check fail on the very comments that record the fix, and get
 * it deleted or weakened.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const BANNED = [
  {
    name: "sendDocument",
    why: "pushes a PDF to Meta as an attachment. Store it and send a link instead — see storeSharedPdf + whatsappHandoff.",
    definedIn: "src/lib/whatsapp/send.ts",
  },
];

let failures = 0;

for (const { name, why, definedIn } of BANNED) {
  const callers: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    if (file === definedIn) continue;
    const body = code(readFileSync(file, "utf8"));
    // An import or a call. Either is a caller for this purpose: importing it is
    // how the call comes back.
    if (new RegExp(`\\b${name}\\s*\\(`).test(body) || new RegExp(`\\b${name}\\b[^(]*from`).test(body)) {
      callers.push(file);
    }
  }
  if (callers.length > 0) {
    failures++;
    console.log(`  FAIL ${name} has ${callers.length} caller(s): ${callers.join(", ")}`);
    console.log(`       ${why}`);
  } else {
    console.log(`  ok   ${name} has no callers`);
  }
}

/*
 * The other half of the same rule: the share link is what carries a document
 * out, so the helper that mints it must still be the thing the send paths use.
 * A path that stopped calling it would be a path that found another way out.
 */
const sharePaths = [
  "src/lib/sharing/actions.ts",
  "src/lib/clients/roster.ts",
  "src/lib/intake/quickActions.ts",
];
for (const path of sharePaths) {
  const body = code(readFileSync(path, "utf8"));
  const ok = /storeSharedPdf\s*\(/.test(body) || /createRoundWhatsAppShare|createWhatsAppShare/.test(body);
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${path} goes out through the share-link path`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed — a document can leave as bytes.`);
  process.exit(1);
}
console.log("\nEvery clinical document leaves as an expiring link, not as bytes.");
