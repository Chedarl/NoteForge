import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAdminClient, BUCKET_EXPORTS } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { logSafe } from "@/lib/redact";
import { submissionPdfFilename } from "@/lib/export/submissionPdf";
import { TEMPLATES } from "@/lib/intake/templates";
import type { TemplateKind } from "@prisma/client";

type ClaimedShare = {
  id: string;
  practiceId: string;
  submissionId: string | null;
  documentKind: string;
  storagePath: string;
};

/** The §5 filename, rebuilt from the submission. Falls back if it has gone. */
async function shareFilename(
  submissionId: string | null,
  practiceId: string,
  documentKind: string
): Promise<string> {
  // A client list has no submission to name itself after, and a round is named
  // by its first one only for the anchor's sake — neither should borrow the §5
  // per-submission filename, which is meant to be split apart by a machine.
  if (!submissionId || documentKind !== "submission") {
    const day = new Date().toISOString().slice(0, 10);
    return documentKind === "roster"
      ? `noteforge_${day}_client-list.pdf`
      : `noteforge_${day}_client-updates.pdf`;
  }

  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, practiceId },
    select: {
      id: true,
      encounterDate: true,
      templateKind: true,
      client: { select: { clientCode: true } },
    },
  });
  if (!submission) return "noteforge-source.pdf";

  return submissionPdfFilename({
    clientCode: submission.client.clientCode,
    encounterDate: submission.encounterDate.toISOString().slice(0, 10),
    encounterType: TEMPLATES[submission.templateKind as TemplateKind].name,
    submissionId: submission.id,
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return unavailable();
  const tokenHash = createHash("sha256").update(token).digest("hex");

  /*
   * One atomic claim enforces expiry and the download ceiling even when two
   * recipients tap the link at the same moment.
   *
   * This lives on `/download` rather than on the link itself because messengers
   * prefetch URLs to build preview cards. When the claim was on the link, every
   * preview spent one of the ten downloads and a link could be dead before the
   * recipient ever tapped it. Viewing the landing page is free; arriving here is
   * a deliberate act.
   */
  const rows = await prisma.$queryRaw<ClaimedShare[]>(Prisma.sql`
    UPDATE "ShareLink"
    SET "downloadCount" = "downloadCount" + 1,
        "lastDownloadedAt" = CURRENT_TIMESTAMP
    WHERE "tokenHash" = ${tokenHash}
      AND "revokedAt" IS NULL
      AND "expiresAt" > CURRENT_TIMESTAMP
      AND "downloadCount" < "maxDownloads"
    RETURNING "id", "practiceId", "submissionId", "storagePath", "documentKind"
  `);
  const share = rows[0];
  if (!share) return unavailable();

  const [bucket, ...parts] = share.storagePath.split("/");
  const key = parts.join("/");
  if (bucket !== BUCKET_EXPORTS || !key) return unavailable();

  const { data, error } = await createAdminClient().storage.from(bucket).download(key);
  if (error || !data) {
    logSafe("share", "private PDF download failed", { shareId: share.id, error: error?.message });
    return unavailable();
  }

  await writeAudit({
    practiceId: share.practiceId,
    actor: null,
    action: "share.downloaded",
    entityType: "share",
    entityId: share.id,
    entityLabel: share.submissionId ?? share.documentKind,
  });

  /*
   * §5 names the file `[ClientID]_[date]_[EncounterType]_[SubmissionID].pdf`,
   * and that has to hold on this route too — these filenames are meant to be
   * split by a machine, and a note writer receiving `noteforge-source.pdf` for
   * every client has to open each one to find out what it is. The stored object
   * key stays random on purpose, so the name is rebuilt here rather than
   * exposing the storage path.
   */
  const filename = await shareFilename(share.submissionId, share.practiceId, share.documentKind);

  const bytes = await data.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function unavailable() {
  return new Response("This secure PDF link is invalid, expired, or has reached its download limit.", {
    status: 410,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
