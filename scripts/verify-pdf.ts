import { writeFile } from "fs/promises";
import { resolve } from "path";
import { renderSubmissionPdf } from "../src/lib/export/pdf";

/**
 * Renders the §5 submission PDF from synthetic data, with no database.
 *
 * This exists because a green type-check says nothing about whether the running
 * footer is on the page. Two failures in `@react-pdf/renderer` are silent —
 * `lineHeight` on a Page style drops every `fixed` element with a `render`
 * callback, and a `<Text render>` inside an absolutely-positioned `fixed` View
 * drops the whole View — so the only way to know the document is right is to
 * generate one and read it.
 *
 * The text is long on purpose: it has to run past a page boundary, or the
 * repeated header, the repeated footer and the page counter are never exercised.
 *
 * `npm run verify:pdf [path]`
 */
async function main() {
  const output = resolve(process.argv[2] ?? "/tmp/noteforge-pdf-verification.pdf");

  const longSynthetic = Array.from(
    { length: 24 },
    (_, index) =>
      `Synthetic verification paragraph ${index + 1}. It exists only to test line wrapping, page breaks, repeated headers, and footer placement without using a real person's clinical information.`
  ).join(" ");

  const pdf = await renderSubmissionPdf({
    submissionId: "verification-submission-id",
    practiceName: "NoteForge Verification Practice",

    clientCode: "DEMO-0104",
    clientName: null,
    initials: "A.B.",
    birthYear: 1988,

    clientStatus: "Active",
    clientStatusSince: "2026-01-04",
    clientStatusReason: null,

    encounterDate: "2026-08-10",
    encounterType: "SOAP",
    discipline: "Therapist",
    professional: "Jordan Clinician",
    professionalRole: "Therapist",
    source: "typed",
    state: "Queued for note production",
    submittedAt: "2026-08-11 12:00",
    handoverDelayDays: 1,

    sections: [
      { label: "Subjective", value: longSynthetic },
      {
        label: "Objective",
        value:
          "Synthetic verification text only. The client participated throughout the encounter and completed the planned review.",
      },
      {
        label: "Assessment",
        value:
          "Synthetic verification text only. The submitted material indicates continued need for follow-up without making an automated clinical decision.",
      },
      // Left empty on purpose: an unfilled section must print "Not recorded"
      // rather than disappearing, so an absence stays distinguishable from an
      // oversight.
      { label: "Plan", value: null },
    ],
    transcript: null,
    openFlags: [
      { kind: "NEAR_DUPLICATE", detail: "Synthetic flag, to check the flag block renders." },
    ],
    changes: {
      previous: {
        id: "verification-previous-id",
        sessionDate: "2026-08-03",
        template: "SOAP",
        templateCode: "SOAP",
        submittedBy: "Jordan Clinician",
        discipline: "Therapist",
      },
      daysSincePrevious: 7,
      comparable: true,
      fields: [
        { fieldId: "subjective", label: "Subjective", status: "changed" },
        { fieldId: "objective", label: "Objective", status: "unchanged" },
        { fieldId: "assessment", label: "Assessment", status: "added" },
        { fieldId: "plan", label: "Plan", status: "cleared" },
      ],
      clinicianStatement: null,
    },
    changeHeadline: "3 of 4 sections changed since the SOAP submission 7 days earlier.",

    generatedAt: "2026-08-11 12:00Z",
  });

  await writeFile(output, pdf);
  console.log(output);
}

void main();
