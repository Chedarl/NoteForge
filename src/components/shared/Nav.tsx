"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import BrandLogo from "@/components/shared/BrandLogo";

/**
 * The signed-in header.
 *
 * A light bar rather than the black slab this used to be. The slab existed
 * because the supplied logo is artwork on a black canvas, so the whole header
 * was darkened to hide it — which inverted the app relative to its own sign-in
 * screen, and you went from a calm white page to a heavy black one simply by
 * logging in. The logo keeps its dark chip and everything around it gets out of
 * the way.
 *
 * It is a client component so it can highlight where you are. Every layout used
 * to pass `current=""`, so nothing was ever marked active and the bar gave no
 * sense of place at all. Reading the path here means a new page cannot forget
 * to wire it up.
 *
 * On a phone the links scroll sideways rather than wrapping. Wrapping turned
 * six items into three stacked rows and pushed the actual work off the first
 * screen, which is the opposite of what somebody standing in a corridor needs.
 */
export function Nav({
  items,
  right,
}: {
  items: { href: string; label: string }[];
  right?: React.ReactNode;
}) {
  const pathname = usePathname();

  /**
   * Longest matching prefix wins, so `/t/write` highlights "Write" rather than
   * also lighting up "Clients" at `/t`. An exact match always beats a prefix.
   */
  const activeHref = items.reduce<string | null>((best, item) => {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) return best;
    return best === null || item.href.length > best.length ? item.href : best;
  }, null);

  return (
    <header className="sticky top-0 z-20 border-b border-[color:var(--nf-border)] bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
        <Link href="/" className="shrink-0" aria-label="NoteForge">
          <BrandLogo className="w-28 rounded-lg" />
        </Link>

        <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1 text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
                  active
                    ? "bg-[color:var(--nf-accent-wash)] text-[color:var(--nf-accent)]"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bordered off from the scrolling links: without it, a half-scrolled
            label butts straight up against "Sign out" and reads as broken. */}
        <div className="shrink-0 border-l border-[color:var(--nf-border)] pl-3 text-slate-500">
          {right}
        </div>
      </div>
    </header>
  );
}
