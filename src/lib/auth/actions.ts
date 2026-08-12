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

  /*
   * The account is created already confirmed, and the person is signed straight
   * in. It used to go through `auth.signUp`, which sends a confirmation email
   * and leaves the account unusable until the link is clicked.
   *
   * That was the single thing standing between this product and being usable.
   * Supabase's built-in SMTP is rate-limited to a handful of messages an hour
   * and is explicitly not for production, so on a fresh project a real fraction
   * of people who sign up simply never receive the mail and can never sign in.
   * A self-serve tool that silently fails to let a third of its signups
   * through is not shipped, whatever the code says.
   *
   * The trade this makes is real and worth stating: **an address is not proven
   * to belong to the person who typed it.** What that does and does not buy an
   * attacker here — a signup creates a *new, empty* practice and never joins an
   * existing one, so registering someone else's address gets you an empty
   * workspace and no access to anybody's data. The cost is that password reset,
   * which does need a working mailbox, may go to someone who cannot read it.
   *
   * Turn this around by configuring real SMTP in Supabase and switching back to
   * `auth.signUp`; the confirmation routes at `/auth/callback` and
   * `/auth/confirm` are already built and stay working either way.
   */
  let authUserId: string;
  try {
    const { data: created, error: createError } = await createAdminClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created.user) {
      // Open registration changes the threat model that the deliberately vague
      // login message was written for. That message protects the staff list of
      // a named practice; here anyone may register, so "already registered" is
      // not a disclosure — and hiding it strands a real person on a screen that
      // will never work for them.
      const alreadyExists =
        createError?.status === 422 ||
        /already|exists|registered/i.test(createError?.message ?? "");
      if (alreadyExists) {
        return { error: "There is already an account with that email. Sign in instead." };
      }
      logSafe("signup", "supabase rejected the registration", { reason: createError?.message });
      return { error: "That account could not be created. Please try again." };
    }
    authUserId = created.user.id;
  } catch (adminError) {
    // No service key configured. Say so rather than failing opaquely.
    logSafe("signup", "admin client unavailable", {
      error: adminError instanceof Error ? adminError.message : String(adminError),
    });
    return {
      error:
        "Registration is not fully configured on this deployment. Ask an administrator to set the Supabase secret key.",
    };
  }

  try {
    await provisionPracticeOwner({
      authUserId,
      email,
      fullName,
      practiceName,
      discipline,
    });
  } catch (provisionError) {
    try {
      await createAdminClient().auth.admin.deleteUser(authUserId);
    } catch (cleanupError) {
      logSafe("signup", "failed to remove unprovisioned auth identity", {
        authUserId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    logSafe("signup", "practice provisioning failed", {
      authUserId,
      error: provisionError instanceof Error ? provisionError.message : String(provisionError),
    });

    /*
     * The commonest cause on a fresh deployment is not a bug in this code: the
     * database exists but the migrations were never run against it, so
     * `User.isPlatformAdmin` and the `ShareLink` table are simply absent. Every
     * signup then fails identically and "please try again" sends people round
     * the same loop forever.
     *
     * P2021 is a missing table and P2022 a missing column, so the two together
     * identify exactly that state and nothing else.
     */
    if (isMissingSchema(provisionError)) {
      return {
        error:
          "This deployment's database has not been set up yet — the tables are missing. An administrator needs to run the database migrations. Check /api/health for what is configured.",
      };
    }

    return { error: "Your workspace could not be created. Nothing was charged; please try again." };
  }

  // Sign them in so the next screen is their workspace and not a login form
  // they have just proved they can pass.
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    logSafe("signup", "created but could not start a session", { authUserId });
    return { success: "Your workspace is ready. Sign in to open it." };
  }

  // Straight to the thing they signed up to do. `homeFor` would send an OWNER
  // to the internal queue, which is not what a clinician came here for.
  redirect("/t/write?welcome=1");
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

/** A table or column the code expects is not in the database yet. */
function isMissingSchema(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }
  // Prisma reports some of these as an initialisation or validation failure
  // rather than a known request error, so the message is the only signal.
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist in the current database|column .* does not exist|relation .* does not exist/i.test(
    message
  );
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