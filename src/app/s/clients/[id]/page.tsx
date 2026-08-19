import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { Card, Pill, SectionTitle, StatusBadge } from "@/components/shared/ui";
import StatusChanger from "@/components/therapist/StatusChanger";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { writeAudit } from "@/lib/audit";
import { identityOf } from "@/lib/clients/identity";
import { openText } from "@/lib/crypto/text";
import { displayPolicyFor } from "@/lib/clients/displayPolicy";

export const dynamic = "force-dynamic";

/**
 * One client's whole story: status timeline, every submission, every note.
 *
 * This is the page a specialist opens when a submission was blocked and
 * somebody has to work out whether the status is wrong or the session predates
 * it. Both facts are on this screen, next to each other, which is the only way
 * that question gets answered in under a minute.
 *
 * Opening it writes an audit row. Reading a client's file is exactly the access
 * a practice is entitled to see recorded.
 */
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["OWNER", "SPECIALIST"]);
  const naming = await displayPolicyFor(user.practiceId);
  const { id } = await params;

  const client = await prisma.client.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      primaryTherapist: { select: { fullName: true } },
      statusEvents: {
        orderBy: { createdAt: "desc" },
        include: { changedBy: { select: { fullName: true } } },
      },
      submissions: {
        orderBy: { encounterDate: "desc" },
        include: {
          submittedBy: { select: { fullName: true } },
          flags: { select: { id: true, kind: true, resolution: true } },
          note: { select: { id: true, state: true, signedAt: true } },
        },
      },
    },
  });
  if (!client) notFound();

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "client.viewed",
    entityType: "client",
    entityId: client.id,
    entityLabel: client.clientCode,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/s/clients" className="text-sm text-slate-500 underline">
          ← Clients
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{client.clientCode}</h1>
        <span className="text-sm text-slate-500">
          {identityOf(naming, client).displayName ?? client.initials}
          {client.birthYear ? ` · b. ${client.birthYear}` : ""}
        </span>
        <StatusBadge status={client.status} />
        <div className="ml-auto">
          <StatusChanger clientId={client.id} current={client.status} />
        </div>
      </div>

      {client.status !== "ACTIVE" ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          New notes are refused for this client since {fmtDate(client.statusChangedAt)}
          {openText(client.statusReasonEnc) ? ` — ${openText(client.statusReasonEnc)}` : ""}. Everything below stays
          readable; that is deliberate, an inactive record is still an auditable one.
        </div>
      ) : null}

      <section>
        <SectionTitle hint="Append-only. Nothing here is ever edited or removed.">
          Status timeline
        </SectionTitle>
        <div className="space-y-1.5">
          {client.statusEvents.map((event) => (
            <Card key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className="text-xs tabular-nums text-slate-400">
                {fmtDateTime(event.createdAt)}
              </span>
              <span className="text-sm">
                {event.fromStatus ? `${event.fromStatus} → ` : "opened as "}
                <strong className="font-medium">{event.toStatus}</strong>
              </span>
              <Pill>{event.source.toLowerCase().replace("_", " ")}</Pill>
              <span className="text-xs text-slate-500">
                {event.changedBy?.fullName ?? "system"}
              </span>
              {openText(event.reasonEnc) ? (
                <span className="w-full text-xs text-slate-600">{openText(event.reasonEnc)}</span>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle hint={`${client.submissions.length} in total, newest session first.`}>
          Submissions
        </SectionTitle>
        <div className="space-y-2">
          {client.submissions.map((submission) => (
            <Card key={submission.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm tabular-nums">{fmtDate(submission.encounterDate)}</span>
              <Pill>{submission.templateKind}</Pill>
              <Pill tone={submission.kind === "PHOTO" ? "amber" : "slate"}>
                {submission.kind === "PHOTO" ? "photo" : "typed"}
              </Pill>
              <Pill
                tone={
                  submission.state === "BLOCKED"
                    ? "rose"
                    : submission.state === "DONE"
                      ? "emerald"
                      : "slate"
                }
              >
                {submission.state.toLowerCase().replace("_", " ")}
              </Pill>
              {submission.flags
                .filter((f) => f.resolution === "OPEN")
                .map((flag) => (
                  <Pill key={flag.id} tone={flag.kind === "CONFLICT" ? "rose" : "amber"}>
                    {flag.kind.toLowerCase().replace("_", " ")}
                  </Pill>
                ))}
              <span className="text-xs text-slate-500">{submission.submittedBy.fullName}</span>
              <span className="ml-auto flex items-center gap-3 text-sm">
                {submission.state === "BLOCKED" ? (
                  <span className="text-xs text-slate-500">Not queued — status refused it</span>
                ) : (
                  <Link href={`/s/note/${submission.id}`} className="text-sky-700 underline">
                    {submission.note?.signedAt ? "View note" : "Open"}
                  </Link>
                )}
                {/* A plain anchor: a file download, not a navigation. Prefetching
                    it would render a PDF and audit a read for every row shown. */}
                <a
                  href={`/api/export/submission/${submission.id}`}
                  target="_blank"
                  rel="noopener"
                  className="text-xs text-slate-600 underline"
                >
                  PDF
                </a>
              </span>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
