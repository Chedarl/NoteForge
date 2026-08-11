import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and public capability links. Confirmation
     * links authenticate with a signature; PDF shares authenticate with a
     * high-entropy, hashed-at-rest token. Neither requires a browser session.
     */
    "/((?!_next/static|_next/image|favicon.ico|confirm|share|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};