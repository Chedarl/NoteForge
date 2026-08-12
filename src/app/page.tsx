import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth/session";
import { SchemaBehindError } from "@/lib/db/schemaLag";
import type { User } from "@prisma/client";

export const dynamic = "force-dynamic";

/** The root is a signpost, never a landing page. There is nothing public here. */
export default async function Home() {
  /*
   * The root reads the session directly rather than through `requireRole`, so
   * it needs the schema-lag case handled here too. Without this the first thing
   * anybody sees on a deployment whose database is behind is a blank error at
   * the domain itself, which reads as "the whole site is down".
   */
  let user: User | null;
  try {
    user = await getSessionUser();
  } catch (error) {
    if (error instanceof SchemaBehindError) redirect("/setup-required");
    throw error;
  }

  redirect(user ? homeFor(user.role) : "/login");
}
