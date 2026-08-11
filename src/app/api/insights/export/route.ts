import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/session";
import { metricsToCsv, operationalMetrics } from "@/lib/insights/metrics";
import { writeAudit } from "@/lib/audit";

/**
 * CSV of the operational figures.
 *
 * Counts and durations only — there is no client, no submission and no note
 * text in this file. An export is the easiest way for clinical material to
 * leave a controlled environment (it lands in a Downloads folder, gets emailed,
 * gets opened on a laptop in a café), so the export deliberately contains
 * nothing that would matter if it did.
 *
 * The download is audited, because "who took data out" is the single most
 * important line in an audit trail.
 */
export async function GET(request: Request) {
  const user = await requireRoleApi(["OWNER", "SPECIALIST"]);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("range") ?? 30) || 30));

  const since = new Date();
  since.setDate(since.getDate() - days);

  const metrics = await operationalMetrics(user.practiceId, since);
  const csv = metricsToCsv(metrics, `last ${days} days`);

  await writeAudit({
    practiceId: user.practiceId,
    actor: user,
    action: "insights.exported",
    entityType: "insights",
    entityId: user.practiceId,
    entityLabel: `last ${days} days`,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="noteforge-metrics-${days}d.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
