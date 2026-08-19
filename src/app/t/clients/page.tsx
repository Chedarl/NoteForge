import { requireRole } from "@/lib/auth/session";
import ClientRoster from "@/components/therapist/ClientRoster";

export const dynamic = "force-dynamic";

/**
 * The caseload, at its own address.
 *
 * It used to live at `/t`, which is now the per-discipline dashboard. The list
 * itself did not change — it moved whole, into `ClientRoster`, so that sending
 * the client list, changing a status and the confirmation pill all kept working
 * rather than being rewritten into the new screen and quietly losing a feature.
 */
export default async function ClientsPage() {
  const user = await requireRole(["THERAPIST", "OWNER"]);
  return <ClientRoster user={user} />;
}
