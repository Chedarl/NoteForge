"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { homeFor } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/security/rateLimit";

export interface LoginState {
  error?: string;
}

/**
 * Sign in.
 *
 * The failure message is identical whether the email is unknown, the password
 * is wrong, or the account exists but has been suspended. That is not
 * unhelpfulness — in a system whose account list is the staff of a named
 * therapy practice, a message distinguishing "no such user" from "wrong
 * password" is an account-enumeration oracle pointed at a small, identifiable
 * group of people.
 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) return { error: "Enter your email and password." };

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = checkRateLimit(`login:${ip}`, 10, 300);
  if (!limit.ok) {
    return { error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Those details did not work." };

  const user = await prisma.user.findUnique({ where: { authUserId: data.user.id } });
  if (!user || user.status !== "ACTIVE") {
    // Authenticated with Supabase but not authorized here. Drop the session so
    // the browser is not left holding a token this application will not honour.
    await supabase.auth.signOut();
    return { error: "Those details did not work." };
  }

  redirect(next && next.startsWith("/") ? next : homeFor(user.role));
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
