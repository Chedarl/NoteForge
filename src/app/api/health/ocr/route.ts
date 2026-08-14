import { NextResponse } from "next/server";
import { requireRoleApi } from "@/lib/auth/session";
import { probeHandwritingReader, PROBE_WORD } from "@/lib/ai/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Does handwriting reading actually work on this deployment?
 *
 * Separate from `/api/health`, and authenticated, for one reason: it spends
 * money. `/api/health` is unauthenticated because the condition it reports is
 * the one that breaks signing in, and it must stay free to call. This makes a
 * real request to a metered API, so anyone holding the URL could run up a bill
 * on somebody else's account. Signed-in staff only.
 *
 * It sends a generated image reading "NOTE OK" and checks the words come back.
 * That end-to-end path — key accepted, model id still live, vision enabled,
 * JSON shape honoured — is the only thing that answers the question. A key
 * being present answers a different and much weaker one, and `/api/health`
 * reports that separately as `handwritingReading`.
 */
export async function GET() {
  const user = await requireRoleApi(["OWNER", "SPECIALIST"]);
  if (!user) {
    // Deliberately terse. An unauthenticated caller learns nothing about
    // whether the endpoint exists or what it would have said.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const probe = await probeHandwritingReader();

  return NextResponse.json(
    probe.ok
      ? {
          working: true,
          model: probe.model,
          testWord: PROBE_WORD,
          readBack: probe.readBack,
          milliseconds: probe.ms,
          note: "A real call was made to the provider and the test image was read correctly.",
        }
      : {
          working: false,
          reason: probe.reason,
          detail: probe.detail,
          model: probe.model,
          testWord: PROBE_WORD,
          milliseconds: probe.ms,
          note: "Photograph upload still works — pages arrive with an empty transcript box to type into.",
        },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
