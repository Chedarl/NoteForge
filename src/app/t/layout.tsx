import { requireRole } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { Nav } from "@/components/shared/ui";

export const dynamic = "force-dynamic";

export default async function TherapistLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["THERAPIST", "OWNER"]);

  return (
    <div className="min-h-screen">
      <Nav
        items={[
          { href: "/t", label: "My clients" },
          // First, because it is the thing most clinicians open the app to do.
          { href: "/t/write", label: "Write an update" },
          { href: "/t/new", label: "Structured note" },
          { href: "/t/upload", label: "Photograph paper" },
          { href: "/t/insights", label: "Insights" },
          { href: "/t/profile", label: "Your discipline" },
        ]}
        current=""
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
