/*
 * Deliberately *not* `server-only`, unlike its caller.
 *
 * The convention in CLAUDE.md is that anything touching the database, a key or
 * a secret is marked server-only. This file touches none of them: it takes a
 * plain object and returns bytes. `submissionPdf.ts` is the half that reads
 * Prisma and decrypts a name, and that one is marked.
 *
 * Keeping the mark off has a practical payoff. `server-only` resolves through
 * the `react-server` export condition, and `@react-pdf/renderer`'s reconciler
 * breaks under that condition — so a file carrying both cannot be rendered from
 * a plain script. Without it, `npm run verify:pdf` can exercise the real layout
 * against synthetic data with no database and no Next.js, which is how the
 * page-break and running-footer behaviour is actually checked.
 */

import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ChangeSummary, FieldChangeStatus } from "@/lib/export/changes";

/**
 * The submission PDF — `docs/REQUIREMENTS.md` §5, marked critical.
 *
 * This is the artefact the whole platform exists to produce. A note writer, or a
 * model working on their behalf, reads this file and writes a SIRP, BIRP or
 * Psych Eval from it. NoteForge does not write that note (§6); it makes the
 * material unambiguous enough that writing one is mechanical.
 *
 * Every layout decision below is downstream of that single reader, so they are
 * worth stating rather than leaving to be inferred:
 *
 * **Real text, never an image.** Built with `@react-pdf/renderer` over the
 * standard PDF fonts, so every glyph is selectable, searchable and extractable
 * without OCR. A scanned-looking PDF would put the reader back where they
 * started — re-transcribing — which is the exact problem this product removes.
 * Helvetica is a built-in font: nothing is fetched at render time, so the
 * generator works in a sealed network with no font CDN reachable.
 *
 * **Identical labels every time.** Section headings come from `TEMPLATES`, the
 * same structure the intake form renders from, so "Medication" is the string in
 * the form, the Markdown export and this PDF. A downstream parser keyed on a
 * heading cannot be broken by someone rewording a form label — there is only one
 * label to reword.
 *
 * **One logical block per section, and empty means empty.** A field the
 * clinician did not fill in prints as "Not recorded" rather than being dropped.
 * Dropping it makes an absence indistinguishable from an oversight, and a note
 * writer needs to be able to tell "no medication change" from "nobody asked".
 *
 * **Identity, status and provenance survive the page break.** The client code
 * and status are in a running header and the submission id, generated timestamp
 * and recording professional are in a running footer — on every page, per §5, so
 * a page separated from the bundle is still attributable and still safe to act
 * on. `fixed` is what makes react-pdf repeat them across pages rather than
 * printing them once and flowing on.
 *
 * **No decorative clutter.** Rules and a single restrained accent for warnings.
 * Nothing here is styled to look impressive; it is styled to be parsed at speed
 * by a tired human and cheaply by a machine.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The data the renderer needs. Assembled by the caller so this module stays
// pure: no Prisma, no decryption, no audit — it renders what it is handed.
// ─────────────────────────────────────────────────────────────────────────────

export interface PdfSection {
  /** The template's label, verbatim. */
  label: string;
  /** The clinician's text, or null when the section was left empty. */
  value: string | null;
}

export interface SubmissionPdfData {
  submissionId: string;
  practiceName: string;

  clientCode: string;
  /** Included only when the caller opted in. Null keeps the PDF de-identified. */
  clientName: string | null;
  initials: string;
  birthYear: number | null;

  clientStatus: string;
  clientStatusSince: string;
  clientStatusReason: string | null;

  encounterDate: string;
  /**
   * §3's encounter-type dropdown is not built yet, so this is the template name
   * — the closest thing the schema records about what kind of encounter it was.
   * When that field lands it becomes the encounter type and this stays a
   * separate "template" line.
   */
  encounterType: string;
  discipline: string | null;
  professional: string;
  professionalRole: string;
  source: "typed" | "photographed";
  state: string;
  submittedAt: string;
  handoverDelayDays: number;

  sections: PdfSection[];
  /** Verified transcript of photographed pages. Null for typed intake. */
  transcript: string | null;
  openFlags: { kind: string; detail: string | null }[];
  changes: ChangeSummary;
  changeHeadline: string;

  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const WARN = "#b45309";
const WARN_BG = "#fffbeb";

const styles = StyleSheet.create({
  /**
   * Line height is deliberately *not* set here, and must not be moved back.
   *
   * `lineHeight` on the Page style makes `@react-pdf/renderer` drop every
   * `fixed` element that carries a `render` callback — silently, with no error
   * and no gap in the layout. That takes the page numbers off the footer, and
   * the failure is invisible unless the generated file is opened and read. It
   * was found exactly that way. Set line height on the text styles below
   * instead, where it has the same effect and no side effect.
   */
  page: {
    paddingTop: 76,
    paddingBottom: 58,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
  },

  runningHeader: {
    position: "absolute",
    top: 28,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  runningHeaderCode: { fontFamily: "Helvetica-Bold", fontSize: 13 },
  runningHeaderStatus: { fontFamily: "Helvetica-Bold", fontSize: 9 },

  /**
   * The footer is two elements rather than one row, for the same reason the
   * page style carries no line height: a `<Text render={…}>` nested inside an
   * absolutely-positioned `fixed` View makes react-pdf drop the whole View. So
   * the provenance line is a View of plain text, and the page counter — the
   * only part that has to be computed per page — is a sibling positioned
   * against the same edge.
   */
  runningFooter: {
    position: "absolute",
    bottom: 26,
    left: 48,
    right: 48,
    paddingTop: 5,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  runningFooterText: { fontSize: 7, color: MUTED },
  runningFooterPage: {
    position: "absolute",
    bottom: 26,
    right: 48,
    paddingTop: 5,
    fontSize: 7,
    color: MUTED,
  },

  statusBanner: {
    marginBottom: 12,
    padding: 8,
    backgroundColor: WARN_BG,
    borderLeftWidth: 3,
    borderLeftColor: WARN,
  },
  statusBannerText: { fontFamily: "Helvetica-Bold", fontSize: 9, lineHeight: 1.35, color: WARN },
  statusBannerBody: { fontSize: 9, lineHeight: 1.4, color: WARN, marginTop: 2 },

  metaGrid: { marginBottom: 14 },
  metaRow: { flexDirection: "row", marginBottom: 1.5 },
  metaLabel: { width: 122, color: MUTED, fontSize: 9, lineHeight: 1.35 },
  metaValue: { flex: 1, fontSize: 9, lineHeight: 1.35 },

  sectionHeading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginTop: 14,
    marginBottom: 4,
    paddingBottom: 2.5,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  body: { fontSize: 10, lineHeight: 1.45 },
  empty: { fontSize: 10, lineHeight: 1.45, color: MUTED, fontFamily: "Helvetica-Oblique" },

  changeBox: {
    marginTop: 6,
    padding: 9,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: "#f9fafb",
  },
  changeHeadline: { fontSize: 9.5, lineHeight: 1.4, marginBottom: 5 },
  changeRow: { flexDirection: "row", marginBottom: 1.5 },
  changeStatus: { width: 76, fontSize: 8.5, fontFamily: "Helvetica-Bold" },
  changeLabel: { flex: 1, fontSize: 9, lineHeight: 1.35 },

  flagRow: { marginBottom: 3 },
  flagKind: { fontFamily: "Helvetica-Bold", fontSize: 9, color: WARN },
  flagDetail: { fontSize: 9, lineHeight: 1.4, color: WARN },

  footnote: {
    marginTop: 18,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: RULE,
    fontSize: 8,
    lineHeight: 1.4,
    color: MUTED,
  },
});

const CHANGE_WORD: Record<FieldChangeStatus, string> = {
  added: "NEW",
  changed: "CHANGED",
  cleared: "NOT RECORDED",
  unchanged: "unchanged",
};

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

/**
 * A section. `wrap={false}` keeps a short block off a page boundary; long ones
 * still break, because a field that genuinely runs over a page must not be
 * silently truncated to preserve a layout preference.
 */
function Section({ label, value }: PdfSection) {
  return (
    <View wrap={value !== null && value.length > 600}>
      <Text style={styles.sectionHeading}>{label}</Text>
      {value ? (
        <Text style={styles.body}>{value}</Text>
      ) : (
        <Text style={styles.empty}>Not recorded.</Text>
      )}
    </View>
  );
}

function SubmissionDocument({ data }: { data: SubmissionPdfData }) {
  const nonActive = data.clientStatus.toLowerCase() !== "active";

  return (
    <Document
      title={`${data.clientCode} ${data.encounterDate} ${data.encounterType}`}
      author={data.practiceName}
      subject={`NoteForge submission ${data.submissionId}`}
      creator="NoteForge"
      producer="NoteForge"
    >
      <Page size="A4" style={styles.page}>
        {/* §5: client identifier and status prominent, on every page. */}
        <View style={styles.runningHeader} fixed>
          <View>
            <Text style={styles.runningHeaderCode}>
              {data.clientCode}
              {data.clientName ? ` — ${data.clientName}` : ` — ${data.initials}`}
            </Text>
            <Text style={{ fontSize: 8, color: MUTED }}>
              {data.practiceName} · session {data.encounterDate} · {data.encounterType}
            </Text>
          </View>
          <Text style={[styles.runningHeaderStatus, nonActive ? { color: WARN } : {}]}>
            {data.clientStatus.toUpperCase()}
          </Text>
        </View>

        {/* §5: timestamp, professional name and role, submission id — every page. */}
        <View style={styles.runningFooter} fixed>
          <Text style={styles.runningFooterText}>
            Submission {data.submissionId} · {data.professional} ({data.professionalRole}) ·
            generated {data.generatedAt}
          </Text>
        </View>
        <Text
          style={styles.runningFooterPage}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />

        {nonActive && (
          <View style={styles.statusBanner}>
            <Text style={styles.statusBannerText}>
              This client is {data.clientStatus} as of {data.clientStatusSince}.
            </Text>
            <Text style={styles.statusBannerBody}>
              {/* The reason is free text a clinician typed; it may or may not
                  already end in a full stop. Normalise rather than print "..". */}
              {data.clientStatusReason ? `${data.clientStatusReason.replace(/[.\s]+$/, "")}. ` : ""}
              Confirm this session predates the status change before writing a note from it.
            </Text>
          </View>
        )}

        <View style={styles.metaGrid}>
          <Meta label="Client identifier" value={data.clientCode} />
          {data.clientName && <Meta label="Client name" value={data.clientName} />}
          {!data.clientName && <Meta label="Client initials" value={data.initials} />}
          {data.birthYear !== null && <Meta label="Birth year" value={String(data.birthYear)} />}
          <Meta label="Client status" value={`${data.clientStatus} since ${data.clientStatusSince}`} />
          <Meta label="Date of encounter" value={data.encounterDate} />
          <Meta label="Encounter type" value={data.encounterType} />
          <Meta label="Professional" value={`${data.professional} (${data.professionalRole})`} />
          <Meta label="Discipline" value={data.discipline ?? "Not recorded"} />
          <Meta label="Record source" value={data.source === "typed" ? "Typed at intake" : "Photographed, transcribed and human-verified"} />
          <Meta label="Submission state" value={data.state} />
          <Meta
            label="Submitted"
            value={`${data.submittedAt} (${data.handoverDelayDays} day${data.handoverDelayDays === 1 ? "" : "s"} after the session)`}
          />
          <Meta label="Submission ID" value={data.submissionId} />
        </View>

        {data.openFlags.length > 0 && (
          <View>
            <Text style={styles.sectionHeading}>Unresolved flags</Text>
            {data.openFlags.map((flag, i) => (
              <View key={i} style={styles.flagRow}>
                <Text style={styles.flagKind}>{flag.kind.replace(/_/g, " ").toLowerCase()}</Text>
                {flag.detail && <Text style={styles.flagDetail}>{flag.detail}</Text>}
              </View>
            ))}
            <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 3 }}>
              A person has not yet resolved these. Read them before writing from this submission.
            </Text>
          </View>
        )}

        {/* §5: a called-out "changes since last submission" section. */}
        <View>
          <Text style={styles.sectionHeading}>Changes since last submission</Text>
          <View style={styles.changeBox}>
            {data.changes.clinicianStatement && (
              <Text style={[styles.body, { marginBottom: 5 }]}>
                {data.changes.clinicianStatement}
              </Text>
            )}
            <Text style={styles.changeHeadline}>{data.changeHeadline}</Text>

            {data.changes.previous && (
              <Text style={{ fontSize: 8.5, color: MUTED, marginBottom: 5 }}>
                Compared against submission {data.changes.previous.id} — {data.changes.previous.template},{" "}
                {data.changes.previous.sessionDate}, recorded by {data.changes.previous.submittedBy}
                {data.changes.previous.discipline ? ` (${data.changes.previous.discipline})` : ""}.
              </Text>
            )}

            {data.changes.fields.map((field) => (
              <View key={field.fieldId} style={styles.changeRow}>
                <Text
                  style={[
                    styles.changeStatus,
                    field.status === "unchanged" ? { color: MUTED, fontFamily: "Helvetica" } : {},
                  ]}
                >
                  {CHANGE_WORD[field.status]}
                </Text>
                <Text style={styles.changeLabel}>{field.label}</Text>
              </View>
            ))}

            <Text style={{ fontSize: 8, color: MUTED, marginTop: 5 }}>
              Derived by comparing this submission against the previous one. It reports which
              sections moved, not whether the change is clinically significant.
            </Text>
          </View>
        </View>

        {data.source === "photographed" ? (
          data.transcript ? (
            <Section label="Transcript of handwritten pages" value={data.transcript} />
          ) : (
            /*
             * A photographed submission whose transcript no person has confirmed
             * yet. The OCR output exists, and it is deliberately not printed:
             * rule 3 of CLAUDE.md — a machine proposes, a named human commits —
             * and an unverified transcript in an export is exactly a machine
             * committing. Printing the template's empty sections instead would
             * be worse than useless, because "Not recorded" reads as *the
             * clinician wrote nothing* when in fact they wrote a page that is
             * sitting in the verification queue.
             */
            <View>
              <Text style={styles.sectionHeading}>Transcript of handwritten pages</Text>
              <Text style={styles.empty}>
                Not yet available. This session was submitted as photographed pages and no person
                has verified the transcript, so nothing is printed here — an unverified machine
                transcript is not a record. The pages are in the verification queue; regenerate
                this PDF once they are confirmed.
              </Text>
            </View>
          )
        ) : (
          data.sections.map((section) => (
            <Section key={section.label} label={section.label} value={section.value} />
          ))
        )}

        <View style={styles.footnote}>
          <Text>
            Collected by NoteForge, which does not write clinical notes and does not replace
            clinical judgement. This document is source material for a note writer.
          </Text>
          <Text style={{ marginTop: 2 }}>
            {data.clientName
              ? "Contains an identifiable client name — treat as a clinical record."
              : "De-identified: the client is named by practice code only."}
            {" Machine-readable JSON of this submission is attached to this PDF as submission.json."}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/** Renders the document to a PDF buffer. */
export async function renderSubmissionPdf(data: SubmissionPdfData): Promise<Buffer> {
  return renderToBuffer(<SubmissionDocument data={data} />);
}
