"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { randomBytes } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/prisma";
import { homeFor } from "@/lib/auth/session";
import { isBootstrapPlatformAdmin } from "@/lib/auth/platform";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { siteUrl } from "@/lib/email/send";
import { logSafe } from "@/lib/redact";
import type { Discipline } from "@prisma/client";

export interface LoginState {
  error?: string;
}

export interface SignupState {
  error?: string;
  success?: string;
}

export interface PasswordState {
  error?: string;
}

const signupSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  practiceName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(128),
  discipline: z.enum([
    "SOCIAL_CASE_WORKER",
    "NURSE_PRACTITIONER",
    "THERAPIST",
    "COUNSELLOR",
    "OTHER",
  ]),
});

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

  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : homeFor(user.role));
}

/**
 * Creates a Supabase identity and its matching practice-owner authorization row.
 *
 * Supabase proves who the person is; Prisma records what they may access. The
 * two writes cannot share a transaction, so a failed database provision is
 * compensated by deleting the just-created Auth identity.
 */
export async function signup(
  _prev: SignupState,
  formData: FormData
): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    practiceName: formData.get("practiceName"),
    email: formData.get("email"),
    password: formData.get("password"),
    discipline: formData.get("discipline"),
  });
  if (!parsed.success) {
    return { error: "Complete every field and use a password of at least 10 characters." };
  }

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = checkRateLimit(`signup:${ip}`, 5, 900);
  if (!limit.ok) {
    return { error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` };
  }

  const { email, password, fullName, practiceName, discipline } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/s`,
      data: { full_name: fullName },
    },
  });

  // Supabase deliberately obscures whether a confirmed address already exists.
  // Keep our response equally non-enumerating and do not create an app profile
  // for the obfuscated identity returned in that case.
  if (error || !data.user || data.user.identities?.length === 0) {
    return {
      success:
        "If this address can be registered, an email is on its way. Follow its link to continue.",
    };
  }

  try {
    await provisionPracticeOwner({
      authUserId: data.user.id,
      email,
      fullName,
      practiceName,
      discipline,
    });
  } catch (provisionError) {
    await supabase.auth.signOut();
    try {
      await createAdminClient().auth.admin.deleteUser(data.user.id);
    } catch (cleanupError) {
      logSafe("signup", "failed to remove unprovisioned auth identity", {
        authUserId: data.user.id,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    logSafe("signup", "practice provisioning failed", {
      authUserId: data.user.id,
      error: provisionError instanceof Error ? provisionError.message : String(provisionError),
    });
    return { error: "Your workspace could not be created. Nothing was charged; please try again." };
  }

  if (data.session) redirect("/s?welcome=1");
  return { success: "Check your email to confirm the account, then your workspace will open." };
}

async function provisionPracticeOwner(input: {
  authUserId: string;
  email: string;
  fullName: string;
  practiceName: string;
  discipline: Discipline;
}): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const code = makePracticeCode(input.practiceName);
      await prisma.$transaction(async (tx) => {
        const practice = await tx.practice.create({
          data: { name: input.practiceName, code },
        });
        await tx.user.create({
          data: {
            authUserId: input.authUserId,
            email: input.email,
            fullName: input.fullName,
            role: "OWNER",
            discipline: input.discipline,
            practiceId: practice.id,
            isPlatformAdmin: isBootstrapPlatformAdmin(input.email),
          },
        });
      });
      return;
    } catch (error) {
      if (isPracticeCodeCollision(error)) continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique practice code");
}

function makePracticeCode(name: string): string {
  const words = name.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  const initials = words.map((word) => word[0]).join("").slice(0, 3);
  const fallback = words.join("").slice(0, 3);
  const prefix = (initials || fallback || "NF").padEnd(2, "X");
  return `${prefix}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

function isPracticeCodeCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes("code") : String(target).includes("code");
}

export async function setPassword(
  _prev: PasswordState,
  formData: FormData
): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 10 || password.length > 128) {
    return { error: "Use a password between 10 and 128 characters." };
  }
  if (password !== confirmation) return { error: "The passwords do not match." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { error: "This invitation has expired. Ask the practice owner to invite you again." };

  const appUser = await prisma.user.findUnique({ where: { authUserId: authUser.id } });
  if (!appUser || appUser.status !== "ACTIVE") {
    return { error: "This account is not active." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "That password could not be saved. Please request a new invitation." };
  redirect(homeFor(appUser.role));
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}