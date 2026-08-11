import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { homeFor } from "@/lib/auth/session";

const OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

/** Supports Supabase's recommended token-hash email templates for SSR apps. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type") as EmailOtpType | null;
  const requestedNext = url.searchParams.get("next");
  const safeNext =
    requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : null;

  if (!tokenHash || !rawType || !OTP_TYPES.has(rawType)) {
    return NextResponse.redirect(new URL("/login?error=link", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    type: rawType,
    token_hash: tokenHash,
  });
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?error=link", request.url));
  }

  const user = await prisma.user.findUnique({ where: { authUserId: data.user.id } });
  if (!user || user.status !== "ACTIVE") {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=access", request.url));
  }

  return NextResponse.redirect(new URL(safeNext ?? homeFor(user.role), request.url));
}
