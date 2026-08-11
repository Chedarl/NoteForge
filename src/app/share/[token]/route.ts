import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAdminClient, BUCKET_EXPORTS } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { logSafe } from "@/lib/redact";

type ClaimedShare = {
  id: string;
  practiceId: string;
  submissionId: string;
  storagePath: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return unavailable();
  const tokenHash = createHash("sha256").update(token).digest("hex");

  // One atomic claim enforces expiry and the download ceiling even when two
  // recipients tap the WhatsApp link at the same moment.
  const rows = await prisma.$queryRaw<ClaimedShare[]>(Prisma.sql`
    UPDATE "ShareLink"
    SET "downloadCount" = "downloadCount" + 1,
        "lastDownloadedAt" = CURRENT_TIMESTAMP
    WHERE "tokenHash" = ${tokenHash}
      AND "revokedAt" IS NULL
      AND "expiresAt" > CURRENT_TIMESTAMP
      AND "downloadCount" < "maxDownloads"
    RETURNING "id", "practiceId", "submissionId", "storagePath"
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
    entityLabel: share.submissionId,
  });

  const bytes = await data.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="noteforge-source.pdf"',
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
