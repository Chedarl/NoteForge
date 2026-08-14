import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and public capability links. Confirmation
     * links authenticate with a signature; PDF shares and field-worker links
     * authenticate with a high-entropy, hashed-at-rest token. None of the three
     * requires a browser session, and `/f` in particular must not redirect to
     * a login page — the person holding it has no account by design.
     */
    "/((?!_next/static|_next/image|favicon.ico|confirm|share|f/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};