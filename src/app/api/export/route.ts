import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/session";
import { buildExport } from "@/lib/export/bundle";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit, limitMessage, requestIdentifier } from "@/lib/security/rateLimit";
import { logSafe } from "@/lib/redact";

/**
 * Downloads the session material as a ZIP.
 *
 * This is the route through which clinical material legitimately leaves the
 * system, so it is the one most worth being strict about:
 *
 *  - **Staff only.** A therapist cannot bulk-download their caseload; that is a
 *    different risk from filing notes and it is not what the portal is for.
 *  - **Practice-scoped.** Client ids arrive from a form and are filtered by
 *    `practiceId` inside `buildExport`, so a guessed id from another tenant
 *    yields nothing rather than an error that confirms it exists.
 *  - **Audited, in detail.** The audit row records the date range, how many
 *    clients and sessions came out, and — crucially — **whether names were
 *    included**. If someone later asks "did an identifiable bundle leave the
 *    system, and when", that question has an answer.
 *  - **Rate limited.** Building a batch export is the most expensive thing this
 *    application does, and it is also the shape of an exfiltration attempt.
 */
export async function GET(request: Request) {
  const user = await requireRoleApi(["OWNER", "SPECIALIST"]);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limit = checkRateLimit(`export:${requestIdentifier(request, user.id)}`, 20, 600);
  if (!limit.ok) return NextResponse.json({ error: limitMessage(limit) }, { status: 429 });

  const url = new URL(request.url);
  const clientIds = (url.searchParams.get("clients") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const from = parseDate(url.searchParams.get("from"), defaultFrom());
  const to = parseDate(url.searchParams.get("to"), new Date());
  if (from > to) {
    return NextResponse.json({ error: "The start date is after the end date." }, { status: 400 });
  }

  const includeNames = url.searchParams.get("names") === "1";
  const includeBlocked = url.searchParams.get("blocked") === "1";

  try {
    const result = await buildExport({
      practiceId: user.practiceId,
      clientIds,
      from,
      to,
      includeNames,
      includeBlocked,
    });

    if (result.sessionCount === 0) {
      return NextResponse.json(
        { error: "No sessions fall in that date range for the selected clients." },
        { status: 404 }
      );
    }

    await writeAudit({
      practiceId: user.practiceId,
      actor: user,
      action: includeNames ? "export.downloaded_with_names" : "export.downloaded",
      entityType: "insights",
      entityId: user.practiceId,
      entityLabel: `${result.clientCount} clients, ${result.sessionCount} sessions`,
      changes: {
        period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
        namesIncluded: { from: null, to: includeNames },
        blockedIncluded: { from: null, to: includeBlocked },
        scope: { from: null, to: clientIds.length ? `${clientIds.length} selected` : "all" },
      },
    });

    return new NextResponse(new Uint8Array(result.zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Length": String(result.zip.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    logSafe("export", "build failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "The export could not be built." }, { status: 500 });
  }
}

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function defaultFrom(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d;
}
