import { requireRole } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { countPendingReviews } from "@/lib/field/reviewQueue";
import { personaFor } from "@/lib/portal/personas";
import { Nav } from "@/components/shared/ui";
import DisciplineBanner from "@/components/therapist/DisciplineBanner";

export const dynamic = "force-dynamic";

export default async function TherapistLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["THERAPIST", "OWNER"]);
  const persona = personaFor(user.discipline);

  /*
   * The bar used to carry the same eight items for everybody, which is what
   * forced each person to translate "what I am holding" into "which tab is
   * that". It comes from the persona now — a recovery coach sees four, a nurse
   * practitioner sees five including her review queue — and adding a portal
   * never means remembering to edit this file.
   *
   * Short labels are still deliberate: long ones wrapped the bar onto three
   * rows on a phone and pushed the actual work below the fold.
   */
  const wantsReview = persona.nav.some((item) => item.href === "/t/review");

  // Counted on every page of the portal on purpose. A field worker's update is
  // sitting unread until this clinician reads it, and a queue you have to
  // remember to visit is a queue that goes stale.
  const waiting = wantsReview ? await countPendingReviews(user.id, user.practiceId) : 0;

  return (
    <div className="min-h-screen">
      <Nav
        items={[
          ...persona.nav.map((item) =>
            item.href === "/t/review" ? { ...item, badge: waiting } : item
          ),
          // The way back to the internal side, for an owner who is both.
          ...(user.role === "OWNER" ? [{ href: "/s", label: "Queue" }] : []),
        ]}
        right={
          <form action={logout} className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">{user.fullName}</span>
            <button className="text-xs text-slate-600 underline">Sign out</button>
          </form>
        }
      />
      {user.discipline ? null : <DisciplineBanner />}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
