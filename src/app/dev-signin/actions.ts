"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DEV_AUTH_COOKIE, devAuthEnabled } from "@/lib/auth/devSession";

/**
 * Sets the development session cookie.
 *
 * Every export of a `"use server"` module is a callable POST endpoint, so this
 * re-checks `devAuthEnabled()` itself rather than trusting that the page which
 * rendered the form did. That is the same reason `reviewQueue.ts` was split out
 * of `review.ts`: the page's check is a courtesy, the action's is the rule.
 *
 * The id is looked up in the database rather than taken at its word, so the
 * cookie can only ever name somebody who already exists.
 */
export async function signInAsDevUser(formData: FormData) {
  if (!devAuthEnabled()) return;

  const userId = String(formData.get("userId") ?? "");
  const next = String(formData.get("next") ?? "") || "/t";

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { authUserId: true, status: true },
  });
  if (!user?.authUserId || user.status !== "ACTIVE") return;

  const jar = await cookies();
  jar.set(DEV_AUTH_COOKIE, user.authUserId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // No `secure`: this exists to be used over http://localhost.
  });

  // Only ever back into this application, never to whatever a `next` parameter
  // was pointed at.
  redirect(next.startsWith("/") ? next : "/t");
}

export async function signOutDevUser() {
  if (!devAuthEnabled()) return;
  const jar = await cookies();
  jar.delete(DEV_AUTH_COOKIE);
  redirect("/dev-signin");
}
