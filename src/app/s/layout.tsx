import { requireRole } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { Nav } from "@/components/shared/ui";

export const dynamic = "force-dynamic";

export default async function SpecialistLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(["OWNER", "SPECIALIST"]);
  const items = [
    { href: "/s", label: "Queue" },
    { href: "/s/clients", label: "Clients" },
    { href: "/s/export", label: "Download" },
    { href: "/s/insights", label: "Insights" },
    { href: "/s/audit", label: "Audit" },
    ...(user.role === "OWNER" ? [{ href: "/s/settings", label: "Team & settings" }] : []),
    ...(user.isPlatformAdmin ? [{ href: "/admin", label: "Platform admin" }] : []),
  ];

  return (
    <div className="min-h-screen">
      <Nav
        items={items}
        right={
          <form action={logout} className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              {user.fullName} · {user.role === "OWNER" ? "Owner" : "Specialist"}
            </span>
            <button className="text-xs text-slate-600 underline">Sign out</button>
          </form>
        }
      />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}