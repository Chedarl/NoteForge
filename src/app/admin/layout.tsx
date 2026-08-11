import { requirePlatformAdmin } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { Nav } from "@/components/shared/ui";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="min-h-screen">
      <Nav
        items={[
          { href: "/admin", label: "Platform overview" },
          { href: "/s", label: "Practice workspace" },
        ]}
        current="/admin"
        right={
          <form action={logout} className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">{admin.fullName} · Admin</span>
            <button className="text-xs text-slate-600 underline">Sign out</button>
          </form>
        }
      />
      <main className="mx-auto max-w-6xl px-4 py-7">{children}</main>
    </div>
  );
}
