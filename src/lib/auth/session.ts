import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { isMissingSchema, SchemaBehindError } from "@/lib/db/schemaLag";
import type { User, UserRole } from "@prisma/client";

/**
 * Resolves the current user.
 *
 * Supabase says *who* they are; this `User` row says what they may do, and it is
 * re-read on every call. That matters more here than in most products: when a
 * therapist leaves a practice, suspending their account has to stop them
 * reading the queue on the next request, not at the next login. A cached claim
 * in a JWT cannot give you that.
 */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  /*
   * This query selects every column on User, including ones added by later
   * migrations, and that turned it into the single point where a lagging
   * database took the entire product down.
   *
   * `isPlatformAdmin` arrived in a later migration. Against a database that had
   * never been migrated, this line threw P2022 — and because every page and
   * every server action reaches the database through `requireRole`, which comes
   * through here, *every* signed-in screen died with a blank "server-side
   * exception" and so did the root redirect. The two screens that had been
   * given a "migrations pending" banner never reached it: they crash in this
   * function, several frames before their own first line runs. That is why
   * those banners appeared to do nothing.
   *
   * Distinguished from "not signed in" rather than folded into it. Returning
   * null here would send the caller to `/login`, where signing in runs this
   * same query and fails the same way — a redirect loop that explains nothing.
   */
  let user: User | null;
  try {
    user = await prisma.user.findUnique({ where: { authUserId: authUser.id } });
  } catch (error) {
    if (isMissingSchema(error)) throw new SchemaBehindError();
    throw error;
  }

  if (!user || user.status !== "ACTIVE") return null;
  return user;
}

/**
 * Runs `getSessionUser`, turning a schema lag into a page that explains itself.
 *
 * Fails closed: nobody is admitted while the schema is behind. The alternative
 * — carrying on with defaults for the missing columns — keeps the app looking
 * usable while writes fail further in, which is the confusion this is meant to
 * end rather than relocate.
 */
async function sessionUserOrExplain(): Promise<User | null> {
  try {
    return await getSessionUser();
  } catch (error) {
    if (error instanceof SchemaBehindError) redirect("/setup-required");
    throw error;
  }
}

/** Everyone who works on your side of the fence. */
export const STAFF_ROLES: UserRole[] = ["OWNER", "SPECIALIST"];

/**
 * The workhorse. Returns the user or sends them to the login page — so a page
 * that forgets to check a role fails closed, by redirecting, rather than open.
 */
export async function requireRole(roles: UserRole[]): Promise<User> {
  const user = await sessionUserOrExplain();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect("/denied");
  return user;
}

/** For API routes, where a redirect is the wrong answer. */
export async function requireRoleApi(roles: UserRole[]): Promise<User | null> {
  // A schema lag is "no", not a 500. The caller turns a null into its own
  // refusal, and `/api/health` — which never comes through here — is where the
  // reason is available.
  let user: User | null;
  try {
    user = await getSessionUser();
  } catch (error) {
    if (error instanceof SchemaBehindError) return null;
    throw error;
  }
  if (!user || !roles.includes(user.role)) return null;
  return user;
}

/** Platform administration is a separate permission from owning one practice. */
export async function requirePlatformAdmin(): Promise<User> {
  const user = await sessionUserOrExplain();
  if (!user) redirect("/login");
  if (!user.isPlatformAdmin) redirect("/denied");
  return user;
}

export async function requirePlatformAdminApi(): Promise<User | null> {
  let user: User | null;
  try {
    user = await getSessionUser();
  } catch (error) {
    if (error instanceof SchemaBehindError) return null;
    throw error;
  }
  return user?.isPlatformAdmin ? user : null;
}

/**
 * Where a given role belongs after logging in. Kept in one place so the login
 * page, the middleware and the root page cannot disagree about it.
 */
export function homeFor(role: UserRole): string {
  /*
   * An owner lands on the writing screen, not the internal queue.
   *
   * This used to send everyone except a THERAPIST to `/s`, which is correct for
   * a big practice where the owner is an administrator — and wrong for the way
   * this product is actually signed up for, where the person registering is a
   * clinician who came here to write updates. They were landing in a production
   * queue with no link to the writing tool anywhere in its navigation, so the
   * main feature was unreachable from the interface.
   *
   * A SPECIALIST still lands on the queue: producing notes from what arrives is
   * their whole job. Owners can reach it from the nav.
   */
  return role === "SPECIALIST" ? "/s" : "/t/write";
}