import { writeFile } from "fs/promises";
import { resolve } from "path";
import { renderSubmissionPdf } from "../src/lib/sharing/pdf";

async function main() {
  const output = resolve(process.argv[2] ?? "/tmp/noteforge-pdf-verification.pdf");
  const longSynthetic = Array.from(
    { length: 24 },
    (_, index) =>
      `Synthetic verification paragraph ${index + 1}. It exists only to test line wrapping, page breaks, repeated headers, and footer placement without using a real person's clinical information.`
  ).join(" ");
  const bytes = await renderSubmissionPdf({
    practiceName: "NoteForge Verification Practice",
    clientCode: "DEMO-0104",
    clientInitials: "A.B.",
    birthYear: 1988,
    submittedBy: "Jordan Clinician",
    encounterDate: new Date("2026-08-10T12:00:00Z"),
    createdAt: new Date("2026-08-11T12:00:00Z"),
    kind: "STRUCTURED",
    templateKind: "SOAP",
    discipline: "THERAPIST",
    fields: {
      subjective:
        longSynthetic,
      objective:
        "Synthetic verification text only. The client participated throughout the encounter and completed the planned review.",
      assessment:
        "Synthetic verification text only. The submitted material indicates continued need for follow-up without making an automated clinical decision.",
      plan:
        "Synthetic verification text only. Continue the documented plan and confirm the next appointment in the source record.",
    },
    rawText: "",
    pages: [],
  });

  await writeFile(output, bytes);
  console.log(output);
}

void main();
