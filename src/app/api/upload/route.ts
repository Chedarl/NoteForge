import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireRoleApi } from "@/lib/auth/session";
import { createAdminClient, BUCKET_PAGES } from "@/lib/supabase/admin";
import { checkRateLimit, limitMessage, requestIdentifier } from "@/lib/security/rateLimit";
import { logSafe } from "@/lib/redact";

/**
 * Mints a short-lived signed URL so a phone can upload a photographed page
 * straight to Supabase Storage.
 *
 * Everything about this route is a restriction:
 *
 *  - **Authenticated, always.** There is no anonymous upload path. Every object
 *    that lands in the bucket has a named person behind it.
 *  - **One bucket, chosen here.** The caller does not get to name a bucket. A
 *    parameter would mean a compromised session could write into the exports
 *    bucket, and there is no reason for the client to have that choice.
 *  - **The key is generated server-side** from the practice, a random UUID and
 *    a sanitised extension. A client-supplied filename would put user-controlled
 *    text into a storage path, and "IMG_0421 (John Smith).jpg" is a PHI leak in
 *    the object key of a file whose whole purpose is not identifying anyone.
 *  - **Rate limited**, because minting URLs is cheap for us and cheaper for a
 *    script.
 */

const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);

export async function POST(request: Request) {
  const user = await requireRoleApi(["THERAPIST", "OWNER", "SPECIALIST"]);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limit = checkRateLimit(`upload:${requestIdentifier(request, user.id)}`, 60, 300);
  if (!limit.ok) return NextResponse.json({ error: limitMessage(limit) }, { status: 429 });

  let body: { contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const extension = ALLOWED.get(String(body.contentType ?? ""));
  if (!extension) {
    return NextResponse.json(
      { error: "Only JPEG, PNG, WebP or PDF pages can be uploaded." },
      { status: 415 }
    );
  }

  const key = `${user.practiceId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${extension}`;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET_PAGES).createSignedUploadUrl(key);
    if (error || !data) {
      logSafe("upload", "could not mint signed URL", { error: error?.message });
      return NextResponse.json({ error: "Storage is not available right now." }, { status: 502 });
    }

    return NextResponse.json({ signedUrl: data.signedUrl, path: `${BUCKET_PAGES}/${key}` });
  } catch (error) {
    logSafe("upload", "storage not configured", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });
  }
}
