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
 *
 * That cure went too far on its own. With the scrollbar hidden and no other
 * signal, a nurse practitioner on a 390px phone saw "Home · Caseload" and
 * nothing else — Review, Team and Profile were off the right-hand edge with no
 * indication they existed, and the unread badge went with them. The review
 * queue's whole justification is that a queue you have to remember to visit is
 * a queue that goes stale, so hiding it is worse than any layout problem it was
 * solving. A fade on the trailing edge says there is more, and the badge is
 * mirrored onto the bar itself so a count can never be the thing that scrolled
 * out of sight.
 */
export function Nav({
  items,
  right,
}: {
  items: { href: string; label: string; badge?: number }[];
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
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-4 sm:px-4">
        <Link href="/" className="shrink-0" aria-label="NoteForge">
          {/* Smaller on a phone. At 390px the full mark took a fifth of the bar
              and squeezed the links it sits beside into unreadable stubs. */}
          <BrandLogo className="w-20 rounded-lg sm:w-28" />
        </Link>

        <div className="relative min-w-0 flex-1">
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                {/* A count only when there is something to count. A grey "0"
                    beside every nav item trains people to stop reading it, and
                    then the one that matters goes unnoticed too. */}
                {item.badge ? (
                  <span
                    className="ml-1.5 inline-flex min-w-[1.15rem] items-center justify-center rounded-full bg-rose-600 px-1 py-px text-[0.65rem] font-bold text-white tabular-nums"
                    aria-label={`${item.badge} waiting`}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/*
          A fade on the trailing edge, so "there is more over here" is visible
          without a scrollbar. Only when there are enough items to overflow a
          phone — a gradient over a bar with nothing to scroll is a lie.
          `pointer-events-none` so it never eats a tap on the last link.
        */}
        {items.length > 3 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent sm:hidden"
          />
        ) : null}
        </div>

        {/*
          The count, mirrored where it cannot scroll away.
          The badge lives on its nav item, and on a phone that item is often off
          the right-hand edge — so the one number a supervising clinician must
          not miss was the one most likely to be invisible. Shown here only when
          there is something waiting, and only on the narrow layout where the
          bar actually overflows.
        */}
        {items.some((item) => item.badge) ? (
          <a
            href={items.find((item) => item.badge)!.href}
            className="shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-[0.7rem] font-bold text-white tabular-nums sm:hidden"
            aria-label={`${items.find((item) => item.badge)!.badge} waiting for review`}
          >
            {items.find((item) => item.badge)!.badge}
          </a>
        ) : null}

        {/* Bordered off from the scrolling links: without it, a half-scrolled
            label butts straight up against "Sign out" and reads as broken. */}
        <div className="shrink-0 border-l border-[color:var(--nf-border)] pl-2 text-slate-500 sm:pl-3">
          {right}
        </div>
      </div>
    </header>
  );
}
