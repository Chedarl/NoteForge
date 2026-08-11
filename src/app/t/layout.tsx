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
          { href: "/t/new", label: "New note" },
          { href: "/t/upload", label: "Photograph paper" },
          { href: "/t/insights", label: "Insights" },
        ]}
        current=""
        right={
          <form action={logout} className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">{user.fullName}</span>
            <button className="text-xs text-slate-600 underline">Sign out</button>
          </form>
        }
      />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
