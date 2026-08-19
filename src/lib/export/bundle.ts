import "server-only";

import { prisma } from "@/lib/prisma";
import { identityOf } from "@/lib/clients/identity";
import { displayPolicyFor } from "@/lib/clients/displayPolicy";
import { TEMPLATES, renderFieldValue } from "@/lib/intake/templates";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { STATUS_LABEL } from "@/lib/clients/labels";
import { createZip, safeSegment } from "@/lib/export/zip";
import type { Discipline, Prisma, TemplateKind } from "@prisma/client";

/**
 * The export. This is the product.
 *
 * NoteForge collects the material; the notes get written elsewhere from what
 * comes out of here. So the bundle is designed backwards from that job, and
 * three decisions follow from it.
 *
 * **Everything is organised by session date.** One file per session, named
 * `2026-08-04.md`, inside a folder per client. Not one file per client with the
 * sessions concatenated — because the unit of work downstream is *a note about
 * one session*, and anything that has to be split apart before it can be used
 * is a step somebody has to get right every time.
 *
 * **Both machine and human formats, from one source.** `sessions.json` is what
 * a script or a model reads: typed fields, ISO dates, explicit nulls. The
 * Markdown is the same content laid out to be read or pasted into a chat
 * window. They are generated from the same objects in the same pass, so they
 * cannot disagree.
 *
 * **Discipline and status travel with every session.** Whatever writes the note
 * needs to know it is looking at a nurse practitioner's encounter rather than a
 * case worker's, and it needs to know if the client has since been discharged
 * or died. Both are on every session record, not just in a header somewhere.
 */

export interface ExportOptions {
  practiceId: string;
  /** Specific clients, or empty for every client with sessions in range. */
  clientIds: string[];
  from: Date;
  to: Date;
  /**
   * Whether decrypted client names appear in the bundle.
   *
   * Default false. The client code is always present and is what everything
   * else in the system keys on, so a bundle without names is fully usable —
   * and an export is the moment material leaves a controlled environment for a
   * Downloads folder, a chat window or a third-party model. Names are a
   * deliberate opt-in, and the choice is recorded in the audit trail either way.
   */
  includeNames: boolean;
  /** Include submissions refused on client status. Off by default. */
  includeBlocked: boolean;
}

export interface ExportResult {
  zip: Buffer;
  filename: string;
  clientCount: number;
  sessionCount: number;
}

interface SessionRecord {
  sessionDate: string;
  submittedAt: string;
  handoverDelayDays: number;
  discipline: string | null;
  disciplineCode: Discipline | null;
  template: string;
  templateCode: TemplateKind;
  source: "typed" | "photographed";
  state: string;
  submittedBy: string;
  /** Template fields, keyed by field id, in template order. Empty for photos. */
  fields: Record<string, string>;
  /** Human-verified transcript of photographed pages. Null for typed intake. */
  transcript: string | null;
  /** Open flags a person has not yet resolved — read before writing the note. */
  openFlags: { kind: string; detail: string | null }[];
}

interface ClientRecord {
  clientCode: string;
  displayName: string | null;
  initials: string;
  birthYear: number | null;
  status: string;
  statusSince: string;
  statusReason: string | null;
  primaryClinician: string | null;
  sessions: SessionRecord[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function buildExport(options: ExportOptions): Promise<ExportResult> {
  const { practiceId, clientIds, from, to, includeBlocked } = options;

  /*
   * Safe mode overrules the request, and it is enforced *here* rather than on
   * the screen that offers the tick box.
   *
   * The export is reached by URL — `/api/export?names=1` — so a checkbox
   * disabled in the browser stops nobody who has ever seen the address bar.
   * This function is the only way an export bundle is built, which makes it the
   * only place the override cannot be gone around. The caller's request is
   * ANDed with the policy: safe mode can refuse names, and it can never add
   * them to an export that did not ask.
   */
  const naming = await displayPolicyFor(practiceId);
  const includeNames = options.includeNames && !naming.safeMode;

  // `to` arrives as a date, meaning "up to and including that day".
  const toEnd = new Date(to);
  toEnd.setHours(23, 59, 59, 999);

  // The same filter is applied to the outer `some` and the inner `where`, and
  // that is not redundant. With only the outer one matching, a client whose sole
  // in-range submission was refused on status came out as a folder with a
  // `_client.md` and no sessions in it — an empty directory in somebody's export
  // that looks like data was lost rather than correctly excluded.
  const submissionFilter: Prisma.SubmissionWhereInput = {
    encounterDate: { gte: from, lte: toEnd },
    state: includeBlocked
      ? { not: "SUPERSEDED" }
      : { notIn: ["SUPERSEDED", "BLOCKED"] },
  };

  const clients = await prisma.client.findMany({
    where: {
      practiceId,
      ...(clientIds.length > 0 ? { id: { in: clientIds } } : {}),
      submissions: { some: submissionFilter },
    },
    include: {
      primaryTherapist: { select: { fullName: true } },
      submissions: {
        where: submissionFilter,
        orderBy: { encounterDate: "asc" },
        include: {
          submittedBy: { select: { fullName: true, discipline: true } },
          pages: { orderBy: { pageNumber: "asc" } },
          flags: { where: { resolution: "OPEN" }, select: { kind: true, detail: true } },
        },
      },
    },
    orderBy: { clientCode: "asc" },
  });

  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { name: true, code: true },
  });

  const records: ClientRecord[] = clients
    .filter((client) => client.submissions.length > 0)
    .map((client) => {
    const identity = identityOf(naming, client);

    return {
      clientCode: client.clientCode,
      displayName: includeNames ? identity.displayName : null,
      initials: client.initials,
      birthYear: client.birthYear,
      status: STATUS_LABEL[client.status],
      statusSince: iso(client.statusChangedAt),
      statusReason: client.statusReason,
      primaryClinician: client.primaryTherapist?.fullName ?? null,
      sessions: client.submissions.map((submission) => {
        // Discipline is read from the submission, which captured it at write
        // time. Falling back to the user's current discipline only when the
        // submission predates the field — never overriding what was recorded.
        const discipline = submission.discipline ?? submission.submittedBy.discipline ?? null;
        const template = TEMPLATES[submission.templateKind as TemplateKind];

        /*
         * Rendered through the shared helper, not read as strings.
         *
         * This exact loop is where an earlier bug lived: every section in the
         * exported ZIP read "_not recorded_" while the build and the type-check
         * were both green. A picker's array would have vanished the same way,
         * silently, and only unzipping the result would have shown it.
         */
        const fields: Record<string, string> = {};
        const raw = (submission.fields ?? {}) as Record<string, unknown>;
        for (const field of template.fields) {
          const rendered = renderFieldValue(raw[field.id], field);
          if (rendered) fields[field.id] = rendered;
        }

        const transcript =
          submission.kind === "PHOTO"
            ? submission.pages
                .map((page) => page.verifiedText ?? "")
                .filter((t) => t.trim())
                .join("\n\n") || null
            : null;

        return {
          sessionDate: iso(submission.encounterDate),
          submittedAt: submission.createdAt.toISOString(),
          handoverDelayDays:
            Math.round(
              ((submission.createdAt.getTime() - submission.encounterDate.getTime()) / 864e5) * 10
            ) / 10,
          discipline: discipline ? DISCIPLINE_LABEL[discipline] : null,
          disciplineCode: discipline,
          template: template.name,
          templateCode: submission.templateKind as TemplateKind,
          source: submission.kind === "PHOTO" ? "photographed" : "typed",
          state: submission.state,
          submittedBy: submission.submittedBy.fullName,
          fields,
          transcript,
          openFlags: submission.flags.map((f) => ({ kind: f.kind, detail: f.detail })),
        };
      }),
    };
  });

  const sessionCount = records.reduce((sum, r) => sum + r.sessions.length, 0);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const files: { path: string; content: string }[] = [
    {
      path: "README.md",
      content: readme(practice?.name ?? "practice", from, to, records, includeNames, includeBlocked),
    },
    {
      path: "sessions.json",
      content: JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          practice: practice?.name ?? null,
          periodFrom: iso(from),
          periodTo: iso(to),
          namesIncluded: includeNames,
          blockedIncluded: includeBlocked,
          clientCount: records.length,
          sessionCount,
          clients: records,
        },
        null,
        2
      ),
    },
  ];

  // One folder per client, one Markdown file per session inside it.
  for (const client of records) {
    const folder = safeSegment(client.clientCode);
    files.push({
      path: `${folder}/_client.md`,
      content: clientMarkdown(client),
    });
    for (const session of client.sessions) {
      files.push({
        path: `${folder}/${safeSegment(session.sessionDate)}.md`,
        content: sessionMarkdown(client, session),
      });
    }
  }

  const scope =
    clientIds.length === 1 && records[0] ? safeSegment(records[0].clientCode) : "batch";

  return {
    zip: createZip(files),
    filename: `noteforge-${scope}-${iso(from)}-to-${iso(to)}-${stamp}.zip`,
    clientCount: records.length,
    sessionCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown
// ─────────────────────────────────────────────────────────────────────────────

function clientHeading(client: ClientRecord): string {
  // Code first, always. The name is a confirmation, never the identifier.
  return client.displayName
    ? `${client.clientCode} — ${client.displayName}`
    : `${client.clientCode} — ${client.initials}`;
}

function sessionMarkdown(client: ClientRecord, session: SessionRecord): string {
  const template = TEMPLATES[session.templateCode];
  const lines: string[] = [
    `# ${clientHeading(client)}`,
    "",
    `**Session date:** ${session.sessionDate}`,
    `**Discipline:** ${session.discipline ?? "not recorded"}`,
    `**Template:** ${session.template}`,
    `**Recorded by:** ${session.submittedBy} (${session.source})`,
    `**Client status at export:** ${client.status} (since ${client.statusSince})`,
    "",
  ];

  if (client.status !== "Active") {
    lines.push(
      `> This client is **${client.status}**${client.statusReason ? ` — ${client.statusReason}` : ""}.`,
      "> Confirm this session predates that before a note is written from it.",
      ""
    );
  }

  if (session.openFlags.length > 0) {
    lines.push("> **Unresolved flags on this submission:**");
    for (const flag of session.openFlags) {
      lines.push(`> - ${flag.kind.replace(/_/g, " ").toLowerCase()}: ${flag.detail ?? ""}`);
    }
    lines.push("");
  }

  lines.push("---", "");

  if (session.transcript) {
    lines.push("## Transcript of handwritten pages", "", session.transcript, "");
  } else {
    for (const field of template.fields) {
      const value = session.fields[field.id];
      lines.push(`## ${field.label}`, "", value || "_not recorded_", "");
    }
  }

  return lines.join("\n");
}

function clientMarkdown(client: ClientRecord): string {
  const lines: string[] = [
    `# ${clientHeading(client)}`,
    "",
    `- **Client code:** ${client.clientCode}`,
    `- **Initials:** ${client.initials}`,
    client.birthYear ? `- **Birth year:** ${client.birthYear}` : null,
    `- **Status:** ${client.status} since ${client.statusSince}`,
    client.statusReason ? `- **Reason:** ${client.statusReason}` : null,
    `- **Clinician:** ${client.primaryClinician ?? "unassigned"}`,
    `- **Sessions in this export:** ${client.sessions.length}`,
    "",
    "## Sessions",
    "",
  ].filter((l): l is string => l !== null);

  for (const session of client.sessions) {
    lines.push(
      `- **${session.sessionDate}** — ${session.template}, ${session.discipline ?? "discipline not recorded"} (${session.source})`
    );
  }

  return lines.join("\n");
}

function readme(
  practiceName: string,
  from: Date,
  to: Date,
  records: ClientRecord[],
  includeNames: boolean,
  includeBlocked: boolean
): string {
  const sessions = records.reduce((sum, r) => sum + r.sessions.length, 0);

  return [
    `# NoteForge export — ${practiceName}`,
    "",
    `Sessions dated **${iso(from)}** to **${iso(to)}**.`,
    `${records.length} client${records.length === 1 ? "" : "s"}, ${sessions} session${sessions === 1 ? "" : "s"}.`,
    "",
    "## What is in here",
    "",
    "- `sessions.json` — everything, structured. Use this for anything automated.",
    "- `<CLIENT-CODE>/_client.md` — that client's status and a list of their sessions.",
    "- `<CLIENT-CODE>/YYYY-MM-DD.md` — one file per session, ready to read or paste.",
    "",
    "Each session carries its **date**, the **discipline** of the clinician who",
    "recorded it, the template used, and the client's status. A note written from",
    "one of these files has everything it needs without opening another.",
    "",
    "## Read this before writing anything from it",
    "",
    "- **Sessions on a non-active client.** Where a client is Discharged, Transferred,",
    "  On hold or Deceased, the file says so at the top. Confirm the session predates",
    "  the status change before writing a note from it.",
    "- **Unresolved flags.** A session with an open flag may be a duplicate of another",
    "  in this bundle, or may contradict one. The flag is quoted in the file.",
    "- **`[?]` and `[illegible]`** in a transcript mark words nobody could read. They",
    "  were deliberately not guessed. Do not fill them in.",
    "- **Empty fields** mean the clinician did not record that section, not that",
    "  nothing happened. They are left visibly empty for the same reason.",
    "",
    "## Identity",
    "",
    includeNames
      ? "Client **names are included** in this export, as a first name and a surname initial. Treat this bundle as identifiable material: it should not be uploaded anywhere you would not put a clinical record."
      : "Client **names are not included**. Clients are identified by their practice code and initials only. Match them back against your own records using the code.",
    "",
    includeBlocked
      ? "Submissions **refused on client status are included** and marked `BLOCKED`. They were never queued for production."
      : "Submissions refused on client status are **excluded**.",
    "",
    "No psychotherapy note text produced by NoteForge is included — this bundle is the",
    "source material as clinicians submitted it.",
    "",
    "---",
    "",
    `Generated ${new Date().toISOString()} by NoteForge. Every export is recorded in the audit trail.`,
  ].join("\n");
}
