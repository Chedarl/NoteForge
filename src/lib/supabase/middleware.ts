import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_AUTH_COOKIE, devAuthEnabled } from "@/lib/auth/devSession";

/**
 * Refreshes the Supabase session cookie on every request and bounces anonymous
 * visitors away from the application shell.
 *
 * This is a convenience, not the security boundary. Middleware runs on the edge
 * with no database access, so it knows only "is somebody logged in", never
 * "may this person see this client". Role and practice are checked in
 * `requireRole`, server-side, on every page and route that matters.
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
    return NextResponse.next({ request });
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

  return response;
}