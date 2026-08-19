/**
 * The template definitions, checked for the things the compiler cannot see.
 *
 * `TemplateField` is a structure, so TypeScript checks its *shape* and nothing
 * about whether it makes sense: a `choice` with no options compiles, two fields
 * sharing an id compile, and a field id referenced from another module as a
 * string literal compiles whether or not it exists. That last one is exactly
 * the shape of bug `verify:portals` was written for after "Record a visit"
 * pointed at a page with no microphone through a green lint, typecheck and
 * build.
 *
 * `clientFacts.ts` names `riskSuicidal` and `goalProgress`; `changes.ts` names
 * `sinceLastContact`; `submissionPdf.ts` names `encounterType`. Rename any one
 * of them in `templates.ts` and every one of those silently starts returning
 * nothing — no chip on the dashboard, no clinician statement on the PDF, and a
 * filename that quietly reverts to the template name. Nothing throws.
 *
 * Needs no database and no Next.js.
 */
import { readFileSync } from "fs";
import { TEMPLATES, fieldType, type TemplateField } from "../src/lib/intake/templates";

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}`, detail === undefined ? "" : JSON.stringify(detail));
  }
};

const entries = Object.entries(TEMPLATES);

console.log("\nField definitions");
for (const [kind, template] of entries) {
  const ids = template.fields.map((f) => f.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  check(`${kind}: field ids are unique`, duplicates.length === 0, duplicates);

  for (const field of template.fields) {
    const type = fieldType(field);
    if (type === "choice" || type === "severity") {
      check(
        `${kind}.${field.id}: ${type} has options`,
        Array.isArray(field.options) && field.options.length > 0
      );
      const optionIds = (field.options ?? []).map((o) => o.id);
      check(
        `${kind}.${field.id}: option ids are unique`,
        new Set(optionIds).size === optionIds.length,
        optionIds
      );
    }
    if (type === "multi") {
      check(
        `${kind}.${field.id}: multi has options or a source`,
        Boolean(field.optionSource) || (field.options ?? []).length > 0
      );
    }
    if (type === "prose") {
      check(`${kind}.${field.id}: prose has rows`, field.rows > 0);
    }
  }
}

/*
 * A field id reused across templates must mean the same thing in each.
 *
 * `plan` and `assessment` are deliberately shared, and that is what makes a
 * client's history comparable across a change of template. But if one template
 * made `medication` prose and another made it a picker, the same key in the
 * same JSON column would hold two different shapes, and `renderFieldValue`
 * would be the only thing standing between that and a note writer reading
 * "[object Object]".
 */
console.log("\nShared field ids agree on their type");
const seen = new Map<string, { kind: string; type: string }>();
for (const [kind, template] of entries) {
  for (const field of template.fields) {
    const type = fieldType(field);
    const prior = seen.get(field.id);
    if (!prior) seen.set(field.id, { kind, type });
    else
      check(
        `${field.id}: ${kind} agrees with ${prior.kind} (${prior.type})`,
        prior.type === type,
        { [prior.kind]: prior.type, [kind]: type }
      );
  }
}

/*
 * Sections group *consecutive* fields, so a field returning to an earlier
 * section name would render that heading twice with the run in between sitting
 * under the wrong one. The compiler sees two identical strings and is content.
 */
console.log("\nSection runs are contiguous");
for (const [kind, template] of entries) {
  const runs: (string | null)[] = [];
  for (const field of template.fields) {
    const title = field.section ?? null;
    if (runs[runs.length - 1] !== title) runs.push(title);
  }
  const named = runs.filter((r): r is string => r !== null);
  check(`${kind}: no section appears twice`, new Set(named).size === named.length, runs);
}

/*
 * A required field with no `since` is one that reaches backwards over every
 * submission already in the database. The four the §3 work added carry one; the
 * ones that predate it are listed by name here, so adding a fifth without
 * deciding the question is a red build rather than a silent cliff in the
 * completeness figure on the insights dashboard.
 */
console.log("\nRequired fields do not reach backwards");
const PREDATES_SECTION_3 = new Set([
  "subjective", "objective", "assessment", "plan", "data", "behaviour",
  "intervention", "response", "narrative", "situation", "needsList", "actions",
  "referrals", "presentation", "observations", "medication",
]);
for (const [kind, template] of entries) {
  for (const field of template.fields) {
    if (!field.required) continue;
    check(
      `${kind}.${field.id}: required, and either dated or older than the §3 sections`,
      Boolean(field.since) || PREDATES_SECTION_3.has(field.id)
    );
  }
}

/*
 * Field ids that other modules name as string literals. Read out of the source
 * rather than imported, because importing them would only prove the *constant*
 * exists — the point is that the id it holds is a real field.
 */
console.log("\nField ids referenced from other modules exist");
const REFERENCES: { file: string; ids: string[]; kind: keyof typeof TEMPLATES }[] = [
  {
    file: "src/lib/portal/clientFacts.ts",
    kind: "NURSING",
    ids: ["riskSuicidal", "riskHomicidal", "riskSelfHarm", "riskSubstance", "medication"],
  },
  { file: "src/lib/portal/clientFacts.ts", kind: "CASE_MANAGEMENT", ids: ["needsList", "goalProgress"] },
  { file: "src/lib/export/changes.ts", kind: "NURSING", ids: ["sinceLastContact"] },
  { file: "src/lib/export/submissionPdf.ts", kind: "NURSING", ids: ["encounterType"] },
];

for (const ref of REFERENCES) {
  const source = readFileSync(new URL(`../${ref.file}`, import.meta.url), "utf8");
  const fields: TemplateField[] = TEMPLATES[ref.kind].fields;
  for (const id of ref.ids) {
    // Word boundary rather than a quoted literal: these appear both as string
    // literals and as property access (`fields.goalProgress`). The point is
    // only to notice that this list has gone stale — the assertion below is
    // the one with teeth.
    check(
      `${ref.file} still names "${id}"`,
      new RegExp(`\\b${id}\\b`).test(source),
      "the reference moved — update this list or the check stops checking"
    );
    check(`${ref.kind} defines "${id}"`, fields.some((f) => f.id === id));
  }
}

console.log(failures === 0 ? "\nTemplates OK\n" : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
