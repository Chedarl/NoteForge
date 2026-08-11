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
          state: { notIn: ["DONE", "SUPERSEDED"] },
          flags: { some: { resolution: "OPEN", kind: { not: "STATUS_BLOCK" } } },
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
          state: { notIn: ["DONE", "SUPERSEDED"] },
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
              : "Nothing is waiting in this part of the queue."
          }
        />
      ) : (
        <div className="space-y-2">
          {submissions.map((submission) => {
            const overdue = ageLabel(submission.createdAt).endsWith("d");
            const unverifiedPages = submission.pages.filter((p) => !p.verifiedText).length;

            return (
              <Card key={submission.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{submission.client.clientCode}</span>
                  <span className="text-xs text-slate-500">
                    {identityOf(submission.client).displayName ?? submission.client.initials}
                  </span>
                  <StatusBadge status={submission.client.status} />
                  {submission.discipline ? (
                    <Pill tone="sky">{DISCIPLINE_LABEL[submission.discipline]}</Pill>
                  ) : null}
                  <Pill>{submission.templateKind.replace(/_/g, " ").toLowerCase()}</Pill>
                  <Pill tone={submission.kind === "PHOTO" ? "amber" : "slate"}>
                    {submission.kind === "PHOTO" ? "Photographed" : "Typed"}
                  </Pill>
                  <span className="text-xs text-slate-500">
                    Session {fmtDate(submission.encounterDate)} · waiting{" "}
                    <span className={overdue ? "font-medium text-amber-700" : ""}>
                      {ageLabel(submission.createdAt)}
                    </span>
                  </span>
                  <span className="ml-auto text-xs text-slate-500">
                    from {submission.submittedBy.fullName}
                  </span>
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

                <div className="flex gap-3 text-sm">
                  {submission.state === "NEEDS_VERIFY" ? (
                    <Link
                      href={`/s/verify/${submission.id}`}
                      className="font-medium text-sky-700 underline"
                    >
                      Verify {unverifiedPages} page{unverifiedPages === 1 ? "" : "s"}
                    </Link>
                  ) : submission.state === "BLOCKED" ? (
                    <Link
                      href={`/s/clients/${submission.client.id}`}
                      className="font-medium text-sky-700 underline"
                    >
                      Reconcile the client status
                    </Link>
                  ) : (
                    <Link
                      href={`/s/note/${submission.id}`}
                      className="font-medium text-sky-700 underline"
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
                    className="font-medium text-slate-600 underline"
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
