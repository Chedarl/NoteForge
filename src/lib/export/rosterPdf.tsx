/*
 * Not `server-only`, for the same reason as `pdf.tsx`: it is pure, it takes a
 * plain object and returns bytes, and the mark would pull in the `react-server`
 * condition that breaks react-pdf's reconciler.
 */

import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

/**
 * The caseload as a document: who this clinician is carrying, and their status.
 *
 * A different job from the submission PDF, and deliberately a different shape.
 * That one is the source material for writing one note; this one answers a
 * single question the practice keeps having to ask by hand — *which of these
 * people are still open?* — so it is a list, sorted so the answer is the first
 * thing on the page.
 *
 * Names are opt-in exactly as they are everywhere else. A roster is arguably
 * the most sensitive artefact in the product: one page listing everyone a
 * clinician sees is a far richer disclosure than any single session, so the
 * default is codes only, and the header says which it is.
 */

export interface RosterRow {
  clientCode: string;
  /** Null unless the sender opted in. */
  name: string | null;
  initials: string;
  status: string;
  statusSince: string;
  statusReason: string | null;
  lastSession: string | null;
  submissions: number;
}

export interface RosterPdfData {
  practiceName: string;
  clinician: string;
  clinicianRole: string;
  generatedAt: string;
  rows: RosterRow[];
  activeCount: number;
  identifiable: boolean;
}

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#d1d5db";
const WARN = "#b45309";

const styles = StyleSheet.create({
  // No lineHeight here — it makes react-pdf drop every `fixed` element with a
  // `render` callback, which would silently remove the footer. See pdf.tsx.
  page: {
    paddingTop: 64,
    paddingBottom: 54,
    paddingHorizontal: 44,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: INK,
  },

  header: {
    position: "absolute",
    top: 26,
    left: 44,
    right: 44,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  headerTitle: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  headerMeta: { fontSize: 8, color: MUTED, marginTop: 2 },

  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    paddingTop: 5,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  footerText: { fontSize: 7, color: MUTED },
  footerPage: {
    position: "absolute",
    bottom: 26,
    right: 44,
    paddingTop: 5,
    fontSize: 7,
    color: MUTED,
  },

  summary: { marginBottom: 12, fontSize: 10 },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#eef2f6",
  },
  headRow: {
    flexDirection: "row",
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  headCell: { fontFamily: "Helvetica-Bold", fontSize: 8, color: MUTED },

  colCode: { width: "20%", fontFamily: "Helvetica-Bold" },
  colName: { width: "24%" },
  colStatus: { width: "20%" },
  colLast: { width: "20%" },
  colCount: { width: "16%", textAlign: "right" },

  inactive: { color: WARN },
  reason: { fontSize: 8, color: MUTED, marginTop: 1 },
});

function RosterDocument({ data }: { data: RosterPdfData }) {
  return (
    <Document
      title={`${data.practiceName} — client list`}
      author={data.practiceName}
      subject="NoteForge client list"
      creator="NoteForge"
      producer="NoteForge"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.headerTitle}>Client list — {data.practiceName}</Text>
          <Text style={styles.headerMeta}>
            {data.clinician} ({data.clinicianRole}) · {data.rows.length} client
            {data.rows.length === 1 ? "" : "s"}, {data.activeCount} active ·{" "}
            {data.identifiable ? "includes names" : "codes only"}
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Generated {data.generatedAt} by NoteForge · status is as recorded at that moment
          </Text>
        </View>
        <Text
          style={styles.footerPage}
          fixed
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />

        <Text style={styles.summary}>
          {data.activeCount} of {data.rows.length} accepting new notes.
        </Text>

        {/* `fixed` repeats the column headings when the list runs past a page. */}
        <View style={styles.headRow} fixed>
          <Text style={[styles.headCell, styles.colCode]}>CLIENT</Text>
          <Text style={[styles.headCell, styles.colName]}>NAME</Text>
          <Text style={[styles.headCell, styles.colStatus]}>STATUS</Text>
          <Text style={[styles.headCell, styles.colLast]}>LAST SESSION</Text>
          <Text style={[styles.headCell, styles.colCount]}>UPDATES</Text>
        </View>

        {data.rows.map((row) => {
          const inactive = row.status.toLowerCase() !== "active";
          return (
            <View key={row.clientCode} style={styles.row} wrap={false}>
              <Text style={styles.colCode}>{row.clientCode}</Text>
              <Text style={styles.colName}>{row.name ?? row.initials}</Text>
              <View style={styles.colStatus}>
                <Text style={inactive ? styles.inactive : undefined}>
                  {row.status}
                </Text>
                <Text style={styles.reason}>since {row.statusSince}</Text>
                {inactive && row.statusReason ? (
                  <Text style={styles.reason}>{row.statusReason}</Text>
                ) : null}
              </View>
              <Text style={styles.colLast}>{row.lastSession ?? "none recorded"}</Text>
              <Text style={styles.colCount}>{row.submissions}</Text>
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

export async function renderRosterPdf(data: RosterPdfData): Promise<Buffer> {
  return renderToBuffer(<RosterDocument data={data} />);
}
