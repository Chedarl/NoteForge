import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_AUTH_COOKIE, devAuthEnabled } from "@/lib/auth/devSession";
import { IDLE_COOKIE, idleTimeoutMinutes, minutesSinceSeen, stampIdleCookie } from "@/lib/auth/idle";

/**
 * Refreshes the Supabase session cookie on every request and bounces anonymous
 * visitors away from the application shell.
 *
 * This is a convenience, not the security boundary. Middleware runs on the edge
 * with no database access, so it knows only "is somebody logged in", never
 * "may this person see this client". Role and practice are checked in
 * `requireRole`, server-side, on every page and route that matters.
 *
 * It is also where the idle timeout lives, because it is the one place that
 * sees every request and can set a cookie on the way out. A Server Component
 * cannot: cookies are read-only during a render.
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isProtected = ["/t", "/s", "/admin"].some(
    (root) => path === root || path.startsWith(`${root}/`)
  );

  /*
   * The development door, when it is open. Returns before the Supabase client
   * exists, because the whole reason this path is here is a machine that cannot
   * reach Supabase — constructing a client and awaiting `getUser()` would hang
   * every request for the network timeout. `devAuthEnabled()` always returns
   * false in production and on any deployment; see the note in `devSession.ts`.
   */
  if (devAuthEnabled()) {
    const signedIn = Boolean(request.cookies.get(DEV_AUTH_COOKIE)?.value);
    if (!signedIn && isProtected) {
      const url = request.nextUrl.clone();
      url.pathname = "/dev-signin";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
    // The idle timeout applies here too. Not for the development door's sake —
    // it is that a control which cannot be exercised locally is a control
    // nobody ever watches work, and this codebase has shipped two of those.
    return applyIdleTimeout(request, NextResponse.next({ request }), signedIn, "/dev-signin");
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Come back to where they were heading once they are in.
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return applyIdleTimeout(request, response, Boolean(user), "/login");
}

/**
 * The idle timeout.
 *
 * A clinical workstation is shared, wheeled between rooms and left unlocked.
 * The session cookie is long-lived on purpose — somebody mid-round should not
 * be thrown out because a token aged — so "how long since this person did
 * anything" is a different question, and nothing was asking it.
 *
 * Only on signed-in traffic. A timeout that also counted the login page would
 * sign people out of a form they were in the middle of filling in.
 *
 * Shared by both branches above so it behaves identically whichever door
 * somebody came through. That is not tidiness: a security control that cannot
 * be exercised on a development machine is one nobody ever watches work, and
 * two of this codebase's worst bugs were exactly that.
 */
async function applyIdleTimeout(
  request: NextRequest,
  response: NextResponse,
  signedIn: boolean,
  signInPath: string
): Promise<NextResponse> {
  const secret = process.env.CONFIRM_LINK_SECRET;
  // No secret means no way to sign the timestamp, and an unsigned one could be
  // pinned by the browser to hold a session open forever. Better to have no
  // timeout than a decorative one.
  if (!signedIn || !secret) return response;

  const idle = await minutesSinceSeen(request.cookies.get(IDLE_COOKIE)?.value, secret);

  if (idle !== null && idle >= idleTimeoutMinutes()) {
    const url = request.nextUrl.clone();
    url.pathname = signInPath;
    url.searchParams.set("timedOut", "1");
    url.searchParams.delete("next");
    const out = NextResponse.redirect(url);
    /*
     * Clear the stamp on the way out, and the development cookie with it.
     * Left behind, the next sign-in would arrive carrying a stale stamp and be
     * bounced straight back — a loop that looks like the password being wrong.
     */
    out.cookies.delete(IDLE_COOKIE);
    out.cookies.delete(DEV_AUTH_COOKIE);
    return out;
  }

  /*
   * Re-stamped on every request, which is what makes this *idle* time rather
   * than session length. Minute granularity means the value only changes once a
   * minute, so most requests write an identical cookie.
   */
  response.cookies.set(IDLE_COOKIE, await stampIdleCookie(secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}