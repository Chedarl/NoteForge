import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the public confirmation link, which
     * authenticates itself with a signature rather than a session — a therapist
     * answering "yes, still active" from their phone at a bus stop should not
     * have to log in first, or they simply will not answer.
     */
    "/((?!_next/static|_next/image|favicon.ico|confirm|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
