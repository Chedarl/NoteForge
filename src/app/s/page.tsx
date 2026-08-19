import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { Card, EmptyState, Pill, StatusBadge } from "@/components/shared/ui";
import { ageLabel, fmtDate } from "@/lib/utils";
import { identityOf } from "@/lib/clients/identity";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import type { Prisma, SubmissionState } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * The work queue.
 *
 * The ordering is the argument. Not newest-first, which is what a list of rows
 * defaults to and which quietly buries the thing that has been waiting five
 * days. Oldest-first inside each tab, because the number a practice judges this
 * service on is turnaround, and the oldest item is always the one closest to
 * missing it.
 *
 * Four tabs, because the four states need genuinely different handling: a page
 * to read, a note to write, a decision to make, and a status to reconcile with
 * a therapist. Mixing them into one list is what a "raw dump" is, and replacing
 * that dump is most of the point of this product.
 */

const TABS = [
  { key: "verify", label: "Needs verifying", states: ["NEEDS_VERIFY"] },
  { key: "ready", label: "Ready to write", states: ["QUEUED", "IN_PROGRESS"] },
  { key: "flagged", label: "Flagged", states: [] },
  { key: "blocked", label: "Blocked on status", states: ["BLOCKED"] },
  /*
   * "Written, but is it filed?"
   *
   * DONE means a note was produced here. It never meant anybody entered it into
   * the practice's own system, and that last step happens somewhere this
   * product cannot see. This tab is the difference: finished work nobody has
   * confirmed reached its destination.
   */
  { key: "unfiled", label: "Written, not filed", states: ["DONE"] },
] as const;

export default async function Queue({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireRole(["OWNER", "SPECIALIST"]);
  const { tab: rawTab } = await searchParams;
  const tab = TABS.find((t) => t.key === rawTab) ?? TABS[1];

  const where: Prisma.SubmissionWhereInput =
    tab.key === "flagged"
      ? {
          practiceId: user.practiceId,
          // AWAITING_REVIEW is excluded deliberately. The other tabs name their
          // states, so they could never show one; this tab selects by exclusion,
          // and a field update that happened to pick up a duplicate flag would
          // have appeared here — readable and writable by the documentation
          // team — before the supervising clinician had read a word of it. That
          // is precisely the bypass the review step exists to prevent.
          state: { notIn: ["DONE", "SUPERSEDED", "AWAITING_REVIEW"] },
          flags: { some: { resolution: "OPEN", kind: { not: "STATUS_BLOCK" } } },
        }
      : tab.key === "unfiled"
        ? {
            practiceId: user.practiceId,
            state: "DONE",
            processedAt: null,
          }
        : {
            practiceId: user.practiceId,
            state: { in: tab.states as unknown as SubmissionState[] },
          };

  const [submissions, counts, practice] = await Promise.all([
    prisma.submission.findMany({
      where,
      // Oldest first — see above.
      orderBy: { createdAt: "asc" },
      take: 100,
      include: {
        client: {
          select: {
            id: true,
            clientCode: true,
            initials: true,
            status: true,
            givenNameEnc: true,
            familyInitial: true,
            birthYear: true,
          },
        },
        submittedBy: { select: { fullName: true } },
        flags: { where: { resolution: "OPEN" }, select: { id: true, kind: true, detail: true } },
        pages: { select: { id: true, verifiedText: true, ocrConfidence: true } },
      },
    }),
    Promise.all([
      prisma.submission.count({ where: { practiceId: user.practiceId, state: "NEEDS_VERIFY" } }),
      prisma.submission.count({
        where: { practiceId: user.practiceId, state: { in: ["QUEUED", "IN_PROGRESS"] } },
      }),
      prisma.submission.count({
        where: {
          practiceId: user.practiceId,
          state: { notIn: ["DONE", "SUPERSEDED", "AWAITING_REVIEW"] },
          flags: { some: { resolution: "OPEN", kind: { not: "STATUS_BLOCK" } } },
        },
      }),
      prisma.submission.count({ where: { practiceId: user.practiceId, state: "BLOCKED" } }),
    ]),
    prisma.practice.findUnique({
      where: { id: user.practiceId },
      select: { slaHours: true, name: true },
    }),
  ]);

  const slaHours = practice?.slaHours ?? 48;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Production queue</h1>
        <p className="mt-1 text-sm text-slate-600">
          {practice?.name} · oldest first · {slaHours}h turnaround target
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t, index) => (
          <Link
            key={t.key}
            href={`/s?tab=${t.key}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              t.key === tab.key
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[index]}</span>
          </Link>
        ))}
      </div>

      {submissions.length === 0 ? (
        <EmptyState
          title="Nothing here"
          body={
            tab.key === "blocked"
              ? "No submissions have been refused on a client status. That is the outcome you want."
              : tab.key === "unfiled"
                ? "Every note that has been written is marked as filed in the practice's own system. Nothing is sitting finished and forgotten."
                : "Nothing is waiting in this part of the queue."
          }
        />
      ) : (
        <div className="space-y-2">
          {submissions.map((submission) => {
            const overdue = ageLabel(submission.createdAt).endsWith("d");
            const unverifiedPages = submission.pages.filter((p) => !p.verifiedText).length;

            return (
              /*
               * Three tiers, not one line of eight competing chips.
               *
               * The identity is what a specialist scans for, so it is the only
               * thing at full size. Everything else — discipline, template,
               * source, who sent it — is context they read once they have found
               * the row, so it drops to one quiet line underneath. The waiting
               * time is pulled right and is the only thing allowed to go amber,
               * because turnaround is the number this service is judged on.
               */
              <Card key={submission.id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <span className="text-[0.95rem] font-semibold tracking-tight">
                    {submission.client.clientCode}
                  </span>
                  <span className="text-sm text-slate-500">
                    {identityOf(submission.client).displayName ?? submission.client.initials}
                  </span>
                  <StatusBadge status={submission.client.status} />
                  <span className="ml-auto text-xs text-slate-500">
                    waiting{" "}
                    <span className={overdue ? "font-semibold text-amber-700" : "font-medium"}>
                      {ageLabel(submission.createdAt)}
                    </span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  {submission.discipline ? (
                    <>
                      <span>{DISCIPLINE_LABEL[submission.discipline]}</span>
                      <span aria-hidden>·</span>
                    </>
                  ) : null}
                  <span className="capitalize">
                    {submission.templateKind.replace(/_/g, " ").toLowerCase()}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{submission.kind === "PHOTO" ? "Photographed" : "Typed"}</span>
                  <span aria-hidden>·</span>
                  <span>Session {fmtDate(submission.encounterDate)}</span>
                  <span aria-hidden>·</span>
                  <span>from {submission.submittedBy.fullName}</span>
                </div>

                {submission.flags.length > 0 ? (
                  <ul className="space-y-1">
                    {submission.flags.map((flag) => (
                      <li key={flag.id} className="flex items-start gap-2 text-xs">
                        <Pill tone={flag.kind === "CONFLICT" ? "rose" : "amber"}>
                          {flag.kind.replace("_", " ").toLowerCase()}
                        </Pill>
                        <span className="text-slate-600">{flag.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-0.5 text-sm">
                  {submission.state === "NEEDS_VERIFY" ? (
                    <Link
                      href={`/s/verify/${submission.id}`}
                      className="nf-btn nf-btn-primary px-3.5 py-2 text-sm"
                    >
                      Verify {unverifiedPages} page{unverifiedPages === 1 ? "" : "s"}
                    </Link>
                  ) : submission.state === "BLOCKED" ? (
                    <Link
                      href={`/s/clients/${submission.client.id}`}
                      className="nf-btn nf-btn-primary px-3.5 py-2 text-sm"
                    >
                      Reconcile the client status
                    </Link>
                  ) : (
                    <Link
                      href={`/s/note/${submission.id}`}
                      className="nf-btn nf-btn-primary px-3.5 py-2 text-sm"
                    >
                      {submission.state === "IN_PROGRESS" ? "Continue note" : "Write note"}
                    </Link>
                  )}

                  {/*
                    §5: the PDF is available in the queue without anyone
                    generating it. Plain anchor, not next/link — this is a file
                    download from a route handler, not a client-side navigation,
                    and prefetching it would render a PDF and write an audit row
                    for every row the queue displays.
                  */}
                  <a
                    href={`/api/export/submission/${submission.id}`}
                    target="_blank"
                    rel="noopener"
                    className="nf-btn nf-btn-quiet px-3.5 py-2 text-sm"
                  >
                    Download PDF
                  </a>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
