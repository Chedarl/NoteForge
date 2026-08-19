/**
 * Every persona action must land somewhere that honours it.
 *
 * The first version of the personas pointed "Record a visit" at
 * `/t/write?dictate=1`. That page reads no search params at all and has no
 * microphone on it — dictation lives on `TemplateField`, which only `/t/new`
 * renders — so the single most important button in the design silently did
 * nothing distinguishable from "Type it out". Lint, typecheck and build were
 * all green. This is the check that catches it.
 */
import { existsSync } from "fs";
import { PERSONAS, PORTAL_FOR_DISCIPLINE } from "../src/lib/portal/personas";
import { TEMPLATES } from "../src/lib/intake/templates";
import { TEMPLATES_FOR_DISCIPLINE } from "../src/lib/intake/disciplines";
import type { Discipline, TemplateKind } from "@prisma/client";

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};

/** Which query params each page actually reads. Update when a page gains one. */
const HONOURS: Record<string, string[]> = {
  "/t": [],
  "/t/new": ["client", "template"],
  "/t/write": [],
  "/t/upload": [],
  "/t/clients": [],
  "/t/team": [],
  "/t/review": [],
  "/t/insights": [],
  "/t/profile": [],
};

for (const [kind, persona] of Object.entries(PERSONAS)) {
  const actions = [persona.primaryAction, ...persona.secondaryActions];
  for (const action of actions) {
    const [path, query] = action.href.split("?");
    check(`${kind} "${action.label}" → ${path} exists`,
      existsSync(`src/app${path}/page.tsx`), action.href);

    const params = query ? [...new URLSearchParams(query).keys()] : [];
    const ignored = params.filter((p) => !(HONOURS[path] ?? []).includes(p));
    check(`${kind} "${action.label}" passes no ignored param`,
      ignored.length === 0, { href: action.href, ignored });

    // A named template must be real, or the select renders with no match.
    const named = query ? new URLSearchParams(query).get("template") : null;
    if (named) {
      check(`${kind} "${action.label}" names a real template`,
        named in TEMPLATES, named);
    }
  }
}

/*
 * And it must be a template the discipline is actually offered — the form
 * validates this server-side and silently falls back, so a mismatch would mean
 * the primary action quietly opens the wrong form.
 */
for (const [discipline, portal] of Object.entries(PORTAL_FOR_DISCIPLINE)) {
  const persona = PERSONAS[portal];
  const href = persona.primaryAction.href;
  const named = href.includes("?")
    ? new URLSearchParams(href.split("?")[1]).get("template")
    : null;
  if (!named) continue;
  const offered = TEMPLATES_FOR_DISCIPLINE[discipline as Discipline];
  check(`${discipline} is offered ${named}`,
    offered.includes(named as TemplateKind), { offered });
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
