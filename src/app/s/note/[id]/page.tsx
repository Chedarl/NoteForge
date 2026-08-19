import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { ensureNote } from "@/lib/workspace/actions";
import { TEMPLATES, renderFieldValue } from "@/lib/intake/templates";
import { practiceNeeds } from "@/lib/intake/practiceNeeds";
import { StatusBadge, Pill } from "@/components/shared/ui";
import NoteEditor from "@/components/specialist/NoteEditor";
import MarkProcessed from "@/components/specialist/MarkProcessed";
import FlagResolver from "@/components/specialist/FlagResolver";
import { identityOf } from "@/lib/clients/identity";
import { DISCIPLINE_LABEL } from "@/lib/intake/disciplines";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import type { TemplateKind } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * The production workspace: source, history and draft on one screen.
 *
 * Everything a specialist needs to write a defensible note is here, because the
 * alternative — opening another tab to check what happened last session — is
 * how a note gets written that contradicts the one before it. The client's
 * status timeline is on this page for the same reason: the specialist is the
 * last person who can catch a note being written against somebody who was
 * discharged two months ago.
 */
export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["OWNER", "SPECIALIST"]);
  const needs = await practiceNeeds(user.practiceId);
  const { id } = await params;

  const note = await ensureNote(id);
  if (!note) notFound();

  const submission = await prisma.submission.findFirst({
    where: { id, practiceId: user.practiceId },
    include: {
      client: {
        include: {
          statusEvents: { orderBy: { createdAt: "desc" }, take: 6 },
          primaryTherapist: { select: { fullName: true } },
        },
      },
      submittedBy: { select: { fullName: true } },
      pages: { orderBy: { pageNumber: "asc" } },
      flags: {
        where: { resolution: "OPEN" },
        include: {
          relatedSubmission: {
            select: { id: true, encounterDate: true, rawText: true, createdAt: true },
          },
        },
      },
      note: { include: { tags: true, signedBy: { select: { fullName: true } } } },
      processedBy: { select: { fullName: true } },
    },
  });
  if (!submission || !submission.note) notFound();

  const previousNotes = await prisma.note.findMany({
    where: {
      clientId: submission.clientId,
      state: { in: ["SIGNED", "DELIVERED"] },
      id: { not: submission.note.id },
    },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, createdAt: true, templateKind: true, body: true },
  });

  const template = TEMPLATES[submission.note.templateKind as TemplateKind];
  const sourceText =
    submission.kind === "PHOTO"
      ? submission.pages.map((p) => p.verifiedText ?? "").filter(Boolean).join("\n\n")
      : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href="/s" className="text-sm text-slate-500 underline">
          ← Queue
        </Link>
        <h1 className="text-lg font-semibold">{submission.client.clientCode}</h1>
        <span className="text-sm text-slate-500">
          {identityOf(submission.client).displayName ?? submission.client.initials}
        </span>
        <StatusBadge status={submission.client.status} />
        {submission.discipline ? (
          <Pill tone="sky">{DISCIPLINE_LABEL[submission.discipline]}</Pill>
        ) : null}
        <Pill>{template.name}</Pill>
        <span className="text-sm text-slate-500">
          Session {fmtDate(submission.encounterDate)} · from {submission.submittedBy.fullName}
        </span>
        {submission.note.state === "SIGNED" || submission.note.state === "DELIVERED" ? (
          <Pill tone="emerald">
            Signed by {submission.note.signedBy?.fullName} · v{submission.note.version}
          </Pill>
        ) : null}
      </div>

      {submission.client.status !== "ACTIVE" ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>This client is {submission.client.status.toLowerCase().replace("_", " ")}.</strong>{" "}
          Since {fmtDate(submission.client.statusChangedAt)}
          {submission.client.statusReason ? ` — ${submission.client.statusReason}` : ""}. Check
          this note belongs to a session that predates the change before you write it up.
        </div>
      ) : null}

      {/*
        The last step, and the one that happens outside this product. Placed
        above the editor rather than below it: a specialist opening a note that
        somebody already filed should learn that before they start editing.
      */}
      <MarkProcessed
        submissionId={submission.id}
        canProcess={
          submission.note.state === "SIGNED" || submission.note.state === "DELIVERED"
        }
        processed={
          submission.processedAt
            ? {
                at: fmtDate(submission.processedAt),
                by: submission.processedBy?.fullName ?? null,
                version: submission.processedNoteVersion,
                reference: submission.processedRef,
              }
            : null
        }
      />

      {submission.flags.length > 0 ? (
        <div className="space-y-2">
          {submission.flags.map((flag) => (
            <FlagResolver
              key={flag.id}
              flagId={flag.id}
              kind={flag.kind}
              detail={flag.detail}
              score={flag.score}
              related={
                flag.relatedSubmission
                  ? {
                      id: flag.relatedSubmission.id,
                      encounterDate: fmtDate(flag.relatedSubmission.encounterDate),
                      excerpt: flag.relatedSubmission.rawText.slice(0, 900),
                    }
                  : null
              }
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ── Left: everything the note is written from ─────────────────── */}
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Source
            </h2>
            {submission.kind === "PHOTO" ? (
              <>
                <p className="mt-1 text-xs text-slate-500">
                  Confirmed transcript of {submission.pages.length} photographed page
                  {submission.pages.length === 1 ? "" : "s"}.{" "}
                  <Link href={`/s/verify/${submission.id}`} className="text-sky-700 underline">
                    Re-open the originals
                  </Link>
                </p>
                <p className="prose-note mt-2 text-sm">{sourceText || "No transcript yet."}</p>
              </>
            ) : (
              <dl className="mt-2 space-y-3">
                {template.fields.map((field) => (
                  <div key={field.id}>
                    <dt className="text-xs font-medium text-slate-500">{field.label}</dt>
                    <dd className="prose-note text-sm">
                      {/* Through the shared renderer: `String(["a","b"])` gave
                          "a,b" with no spacing and an object gave
                          "[object Object]". */}
                      {renderFieldValue(
                        (submission.fields as Record<string, unknown>)[field.id],
                        field
                      ) || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Status history
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Therapist: {submission.client.primaryTherapist?.fullName ?? "unassigned"}
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {submission.client.statusEvents.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-x-2 text-slate-600">
                  <span className="tabular-nums text-slate-400">
                    {fmtDate(event.createdAt)}
                  </span>
                  <span>
                    {event.fromStatus ? `${event.fromStatus} → ` : ""}
                    <strong className="font-medium">{event.toStatus}</strong>
                  </span>
                  {event.reason ? (
                    <span className="w-full text-xs text-slate-500">{event.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Recent notes for this client
            </h2>
            {previousNotes.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">None signed yet.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {previousNotes.map((prev) => (
                  <li key={prev.id}>
                    <div className="text-xs text-slate-500">
                      {fmtDateTime(prev.createdAt)} · {prev.templateKind}
                    </div>
                    <p className="prose-note mt-0.5 line-clamp-4 text-sm text-slate-700">
                      {Object.values(prev.body as Record<string, string>)
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Right: the note being produced ───────────────────────────── */}
        <NoteEditor
          submissionId={submission.id}
          noteId={submission.note.id}
          templateKind={submission.note.templateKind as TemplateKind}
          needs={needs}
        initialBody={submission.note.body as Record<string, string>}
          state={submission.note.state}
          aiAssisted={submission.note.aiAssisted}
          tags={submission.note.tags.map((t) => ({ id: t.id, kind: t.kind, label: t.label }))}
        />
      </div>
    </div>
  );
}
