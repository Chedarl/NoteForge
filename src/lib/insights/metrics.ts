import "server-only";

import { prisma } from "@/lib/prisma";
import { hoursBetween } from "@/lib/utils";
import { assessCompleteness } from "@/lib/intake/templates";
import type { TemplateKind } from "@prisma/client";

/**
 * The numbers that turn this from "somebody who types notes" into "the
 * operations partner".
 *
 * Everything here is a Prisma aggregate over rows that already exist. No
 * warehouse, no scheduled rollup, no extra infrastructure — which matters
 * because the whole platform has to run on free tiers, and because a metric
 * computed from the live rows can never be silently stale.
 *
 * ## The line this file does not cross
 *
 * Operational metrics are about the *process*: how fast, how complete, how many
 * duplicates, how accurate the statuses were. Clinical signal is about the
 * *client*, and everything in that half comes from `NoteTag` — a box a trained
 * specialist ticked — never from a model reading notes and inferring a trend. A
 * "risk increasing" chart derived from an unsupervised classifier is a
 * liability dressed as a feature; the same chart derived from what a
 * professional actually marked is evidence a supervisor can act on.
 *
 * And what a therapist sees is summary only. Counts, dates, trends. Never note
 * text, and never another therapist's clients.
 */

export interface OperationalMetrics {
  received: number;
  delivered: number;
  blocked: number;
  /** Blocked ÷ received. The guardrail's own scoreboard. */
  statusBlockRate: number;
  duplicatesFlagged: number;
  conflictsFlagged: number;
  openFlags: number;
  /** Hours from submission to delivery. Null until something has been delivered. */
  turnaroundP50: number | null;
  turnaroundP90: number | null;
  /** Delivered inside the practice's SLA, as a fraction of delivered. */
  onTimeRate: number | null;
  /** Mean completeness of submissions as received, 0–1. */
  intakeCompleteness: number | null;
  /** Photo pages whose OCR was good enough that nobody had to edit it. */
  firstPassVerifyRate: number | null;
  /** Median days between the session and the therapist handing it over. */
  medianHandoverDays: number | null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[index] * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function operationalMetrics(
  practiceId: string,
  since: Date
): Promise<OperationalMetrics> {
  const [practice, submissions, notes, flagCounts, openFlags, pages] = await Promise.all([
    prisma.practice.findUnique({ where: { id: practiceId }, select: { slaHours: true } }),
    prisma.submission.findMany({
      where: { practiceId, createdAt: { gte: since } },
      select: {
        id: true,
        state: true,
        createdAt: true,
        encounterDate: true,
        templateKind: true,
        fields: true,
        kind: true,
      },
    }),
    prisma.note.findMany({
      where: { practiceId, deliveredAt: { not: null }, createdAt: { gte: since } },
      select: { deliveredAt: true, submission: { select: { createdAt: true } } },
    }),
    prisma.submissionFlag.groupBy({
      by: ["kind"],
      where: { submission: { practiceId }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.submissionFlag.count({
      where: { submission: { practiceId }, resolution: "OPEN" },
    }),
    prisma.submissionPage.findMany({
      where: { submission: { practiceId }, createdAt: { gte: since } },
      select: { ocrText: true, verifiedText: true, ocrConfidence: true },
    }),
  ]);

  const slaHours = practice?.slaHours ?? 48;
  const received = submissions.length;
  const blocked = submissions.filter((s) => s.state === "BLOCKED").length;

  const turnarounds = notes
    .map((n) => hoursBetween(n.submission.createdAt, n.deliveredAt!))
    .sort((a, b) => a - b);

  const countOf = (kind: string) =>
    flagCounts.find((f) => f.kind === kind)?._count._all ?? 0;

  // Completeness is measured on structured intake only. Scoring a photo
  // submission against a template would report a bad number for something that
  // was never claiming to have those fields, and the resulting chart would say
  // "quality is falling" when what actually happened is somebody used paper.
  const structured = submissions.filter((s) => s.kind === "STRUCTURED");
  const completenessRatios = structured.map(
    (s) =>
      assessCompleteness(
        s.templateKind as TemplateKind,
        (s.fields ?? {}) as Record<string, unknown>
      ).ratio
  );

  // "First pass" = OCR was trusted verbatim. Compared after trimming, because a
  // stray newline is not a human disagreeing with the machine.
  const verifiedPages = pages.filter((p) => p.verifiedText !== null && p.ocrText !== null);
  const untouched = verifiedPages.filter(
    (p) => (p.verifiedText ?? "").trim() === (p.ocrText ?? "").trim()
  ).length;

  const handoverDays = submissions.map(
    (s) => hoursBetween(s.encounterDate, s.createdAt) / 24
  );

  return {
    received,
    delivered: notes.length,
    blocked,
    statusBlockRate: received ? blocked / received : 0,
    duplicatesFlagged: countOf("DUPLICATE") + countOf("NEAR_DUPLICATE"),
    conflictsFlagged: countOf("CONFLICT"),
    openFlags,
    turnaroundP50: percentile(turnarounds, 50),
    turnaroundP90: percentile(turnarounds, 90),
    onTimeRate: turnarounds.length
      ? turnarounds.filter((h) => h <= slaHours).length / turnarounds.length
      : null,
    intakeCompleteness: completenessRatios.length
      ? completenessRatios.reduce((a, b) => a + b, 0) / completenessRatios.length
      : null,
    firstPassVerifyRate: verifiedPages.length ? untouched / verifiedPages.length : null,
    medianHandoverDays: median(handoverDays),
  };
}

export interface ClinicalSignal {
  goalProgress: number;
  goalStalled: number;
  risk: number;
  engagementDrop: number;
  /** Clients with no encounter for longer than the practice's staleness window. */
  quietClients: { id: string; clientCode: string; lastEncounterAt: Date | null }[];
}

export async function clinicalSignal(
  practiceId: string,
  since: Date,
  therapistId?: string
): Promise<ClinicalSignal> {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { staleDays: true },
  });
  const staleBefore = new Date();
  staleBefore.setDate(staleBefore.getDate() - (practice?.staleDays ?? 60));

  const [tags, quiet] = await Promise.all([
    prisma.noteTag.groupBy({
      by: ["kind"],
      where: {
        createdAt: { gte: since },
        note: {
          practiceId,
          ...(therapistId ? { client: { primaryTherapistId: therapistId } } : {}),
        },
      },
      _count: { _all: true },
    }),
    prisma.client.findMany({
      where: {
        practiceId,
        status: "ACTIVE",
        ...(therapistId ? { primaryTherapistId: therapistId } : {}),
        OR: [{ lastEncounterAt: null }, { lastEncounterAt: { lt: staleBefore } }],
      },
      select: { id: true, clientCode: true, lastEncounterAt: true },
      orderBy: { lastEncounterAt: "asc" },
      take: 25,
    }),
  ]);

  const countOf = (kind: string) => tags.find((t) => t.kind === kind)?._count._all ?? 0;

  return {
    goalProgress: countOf("GOAL_PROGRESS"),
    goalStalled: countOf("GOAL_STALLED"),
    risk: countOf("RISK"),
    engagementDrop: countOf("ENGAGEMENT_DROP"),
    quietClients: quiet,
  };
}

/** Volume by therapist — the practice-management half of the dashboard. */
export async function therapistVolume(practiceId: string, since: Date) {
  const rows = await prisma.submission.groupBy({
    by: ["submittedById", "state"],
    where: { practiceId, createdAt: { gte: since } },
    _count: { _all: true },
  });

  const users = await prisma.user.findMany({
    where: { practiceId, role: "THERAPIST" },
    select: { id: true, fullName: true },
  });

  return users
    .map((user) => {
      const mine = rows.filter((r) => r.submittedById === user.id);
      const total = mine.reduce((sum, r) => sum + r._count._all, 0);
      const blocked = mine
        .filter((r) => r.state === "BLOCKED")
        .reduce((sum, r) => sum + r._count._all, 0);
      return { id: user.id, name: user.fullName, total, blocked };
    })
    .sort((a, b) => b.total - a.total);
}

/** CSV of the operational figures. Every call site must also write an audit row. */
export function metricsToCsv(metrics: OperationalMetrics, periodLabel: string): string {
  const rows: [string, string | number][] = [
    ["Period", periodLabel],
    ["Submissions received", metrics.received],
    ["Notes delivered", metrics.delivered],
    ["Submissions blocked on status", metrics.blocked],
    ["Status block rate", `${Math.round(metrics.statusBlockRate * 100)}%`],
    ["Duplicates flagged", metrics.duplicatesFlagged],
    ["Conflicts flagged", metrics.conflictsFlagged],
    ["Open flags", metrics.openFlags],
    ["Turnaround p50 (hours)", metrics.turnaroundP50 ?? "n/a"],
    ["Turnaround p90 (hours)", metrics.turnaroundP90 ?? "n/a"],
    [
      "Delivered within SLA",
      metrics.onTimeRate === null ? "n/a" : `${Math.round(metrics.onTimeRate * 100)}%`,
    ],
    [
      "Mean intake completeness",
      metrics.intakeCompleteness === null
        ? "n/a"
        : `${Math.round(metrics.intakeCompleteness * 100)}%`,
    ],
    [
      "OCR accepted without edit",
      metrics.firstPassVerifyRate === null
        ? "n/a"
        : `${Math.round(metrics.firstPassVerifyRate * 100)}%`,
    ],
    [
      "Median handover delay (days)",
      metrics.medianHandoverDays === null ? "n/a" : metrics.medianHandoverDays.toFixed(1),
    ],
  ];
  return ["Metric,Value", ...rows.map(([k, v]) => `"${k}","${v}"`)].join("\n");
}
