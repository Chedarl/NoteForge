import { requireRole } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { countPendingReviews } from "@/lib/field/reviewQueue";
import { Nav } from "@/components/shared/ui";

export const dynamic = "force-dynamic";

export default async function TherapistLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["THERAPIST", "OWNER"]);
  // Counted on every page of the portal on purpose. A field worker's update is
  // sitting unread until this clinician reads it, and a queue you have to
  // remember to visit is a queue that goes stale.
  const waiting = await countPendingReviews(user.id, user.practiceId);

  return (
    <div className="min-h-screen">
      <Nav
        items={[
          // Short labels on purpose: six long ones wrapped the bar onto three
          // rows on a phone and pushed the actual work below the fold.
          // "Write" is first because it is what most clinicians open the app for.
          { href: "/t/write", label: "Write" },
          { href: "/t", label: "Clients" },
          { href: "/t/new", label: "Structured" },
          { href: "/t/upload", label: "Photos" },
          { href: "/t/review", label: "Review", badge: waiting },
          { href: "/t/team", label: "Field team" },
          { href: "/t/insights", label: "Insights" },
          { href: "/t/profile", label: "Profile" },
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
      {user.discipline ? null : (
        <div className="border-b border-amber-300 bg-amber-50">
          <div className="mx-auto max-w-6xl px-4 py-2 text-sm text-amber-900">
            Tell us whether you are a Social Case Worker, Nurse Practitioner or something
            else before filing notes —{" "}
            <a href="/t/profile" className="font-medium underline">
              set your discipline
            </a>
            . It decides which template you get and what kind of note is written from your
            submissions.
          </div>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
