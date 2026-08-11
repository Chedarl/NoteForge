import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoleApi } from "@/lib/auth/session";
import { createAdminClient, BUCKET_PAGES } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { logSafe } from "@/lib/redact";

/**
 * The only way to look at a photographed page.
 *
 * The bucket is private and there are no public URLs anywhere in this codebase.
 * Every view of a clinical image passes through here, which buys three things
 * that a public bucket cannot:
 *
 *  1. **Authorization per object.** The path is looked up against
 *     `SubmissionPage` joined to the caller's practice. A valid path from
 *     another tenant is a 404, not an image.
 *  2. **An audit trail of reads.** `page.viewed` is written before the redirect.
 *     In a system holding clinical material, who *looked* is asked more often
 *     than who edited.
 *  3. **Expiry.** The signed URL lives sixty seconds — long enough to load the
 *     image, short enough that a URL copied out of devtools is useless by the
 *     time anyone tries it.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const user = await requireRoleApi(["OWNER", "SPECIALIST", "THERAPIST"]);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { path } = await params;
  const storagePath = path.join("/");

  const page = await prisma.submissionPage.findFirst({
    where: {
      storagePath,
      submission: {
        practiceId: user.practiceId,
        // A therapist may only see pages from submissions they made. Your team
        // sees everything in the practice, which is the job.
        ...(user.role === "THERAPIST" ? { submittedById: user.id } : {}),
      },
    },
    select: { id: true, submissionId: true, submission: { select: { client: { select: { clientCode: true } } } } },
  });
  if (!page) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [bucket, ...rest] = storagePath.split("/");
  if (bucket !== BUCKET_PAGES) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(rest.join("/"), 60);
    if (error || !data) {
      logSafe("media", "could not sign", { pageId: page.id, error: error?.message });
      return NextResponse.json({ error: "Not available." }, { status: 502 });
    }

    await writeAudit({
      practiceId: user.practiceId,
      actor: user,
      action: "page.viewed",
      entityType: "page",
      entityId: page.id,
      entityLabel: page.submission.client.clientCode,
    });

    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    logSafe("media", "storage not configured", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  }
}
