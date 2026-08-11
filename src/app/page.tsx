import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** The root is a signpost, never a landing page. There is nothing public here. */
export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? homeFor(user.role) : "/login");
}
