import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/session";
import { buildSubmissionPdf } from "@/lib/export/submissionPdf";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit, limitMessage, requestIdentifier } from "@/lib/security/rateLimit";
import { logSafe } from "@/lib/redact";

/**
 * The submission PDF — `docs/REQUIREMENTS.md` §5.
 *
 * Unlike the ZIP bundle, which is staff-only because bulk-downloading a caseload
 * is a different risk from filing notes, this route is open to the recording
 * clinician too. §5 requires it: "downloadable by the professional **and**
 * automatically available in the internal queue". A clinician who cannot get a
 * copy of what they submitted has to keep their own, which is the shadow record
 * this product exists to remove.
 *
 * The scoping that makes that safe:
 *
 *  - **Practice-scoped, then owner-scoped.** Staff see any submission in their
 *    practice. A therapist sees one they recorded or one belonging to a client
 *    they hold. Both constraints are in the query, so anything else is a 404 and
 *    never an error that confirms the row exists.
 *  - **Names off unless asked for.** `?names=1` is a deliberate opt-in and is
 *    audited under a distinct action, so "did an identifiable document leave the
 *    system, and when" has an answer. Everything works without it: the client
 *    code is what the rest of the system keys on.
 *  - **Rate limited**, on the same reasoning as the bundle: a loop over
 *    submission ids is the shape of an exfiltration attempt, and rendering is
 *    the most expensive thing this route does.
 *
 * `Content-Disposition` is `inline` rather than `attachment` so the PDF opens in
 * the browser's viewer; a note writer working through a queue reads far more of
 * these than they save.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireRoleApi(["OWNER", "SPECIALIST", "THERAPIST"]);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limit = checkRateLimit(`pdf:${requestIdentifier(request, user.id)}`, 60, 600);
  if (!limit.ok) return NextResponse.json({ error: limitMessage(limit) }, { status: 429 });

  const { id } = await params;
  const includeName = new URL(request.url).searchParams.get("names") === "1";

  try {
    const result = await buildSubmissionPdf({
      submissionId: id,
      practiceId: user.practiceId,
      includeName,
      restrictToTherapistId: user.role === "THERAPIST" ? user.id : undefined,
    });

    if (!result) {
      return NextResponse.json({ error: "That submission was not found." }, { status: 404 });
    }

    await writeAudit({
      practiceId: user.practiceId,
      actor: user,
      action: result.identifiable
        ? "submission.pdf_downloaded_with_names"
        : "submission.pdf_downloaded",
      entityType: "submission",
      entityId: id,
      entityLabel: `${result.clientCode} · ${result.encounterDate}`,
      changes: {
        namesIncluded: { from: null, to: result.identifiable },
      },
    });

    return new NextResponse(new Uint8Array(result.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${result.filename}"`,
        "Content-Length": String(result.pdf.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    // Ids and states only — never the submission's text. See src/lib/redact.ts.
    logSafe("export", "submission pdf failed", {
      submissionId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "The PDF could not be built." }, { status: 500 });
  }
}
