import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { homeFor } from "@/lib/auth/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next");
  const safeNext =
    requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : null;

  if (!code) return NextResponse.redirect(new URL("/login?error=link", request.url));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
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
