import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/session";
import { Card, Pill } from "@/components/shared/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Actions that changed a record. Everything else is a read. */
const WRITE_ACTIONS = new Set([
  "client.status_changed",
  "submission.created",
  "submission.blocked",
  "submission.verified",
  "note.signed",
  "flag.resolved",
]);

/**
 * The audit trail, readable rather than exportable.
 *
 * Deliberately has no download button. An audit log that can be exported in one
 * click is an audit log that leaves the building, and the thing it is protecting
 * is the record of who touched other people's clinical files. A regulator or an
 * auditor gets a database export under a controlled process, not a CSV from a
 * web page.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireRole(["OWNER", "SPECIALIST"]);
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam ?? 1) || 1);
  const pageSize = 60;

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { practiceId: user.practiceId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where: { practiceId: user.practiceId } }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit trail</h1>
        <p className="mt-1 text-sm text-slate-600">
          Append-only. {total.toLocaleString()} entries, newest first. Views and exports are
          recorded alongside changes — who looked is as answerable as who edited.
        </p>
      </div>

      <div className="space-y-1">
        {entries.map((entry) => (
          <Card key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
            <span className="text-xs tabular-nums text-slate-400">
              {fmtDateTime(entry.createdAt)}
            </span>
            <Pill tone={WRITE_ACTIONS.has(entry.action) ? "sky" : "slate"}>
              {WRITE_ACTIONS.has(entry.action) ? "change" : "read"}
            </Pill>
            <span className="font-mono text-xs">{entry.action}</span>
            <span className="text-sm">
              {entry.actorName}{" "}
              <span className="text-xs text-slate-400">({entry.actorRole.toLowerCase()})</span>
            </span>
            {entry.entityLabel ? (
              <span className="text-xs text-slate-500">{entry.entityLabel}</span>
            ) : null}
            {entry.changes ? (
              <span className="w-full font-mono text-xs text-slate-500">
                {Object.entries(entry.changes as Record<string, { from: unknown; to: unknown }>)
                  .map(([field, change]) => `${field}: ${change.from ?? "—"} → ${change.to ?? "—"}`)
                  .join("  ·  ")}
              </span>
            ) : null}
          </Card>
        ))}
      </div>

      {total > pageSize ? (
        <div className="flex gap-3 text-sm">
          {page > 1 ? (
            <a href={`/s/audit?page=${page - 1}`} className="underline">
              ← Newer
            </a>
          ) : null}
          {page * pageSize < total ? (
            <a href={`/s/audit?page=${page + 1}`} className="underline">
              Older →
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
