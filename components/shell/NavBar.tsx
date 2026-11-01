"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AccountMenu from "@/components/account/AccountMenu";
import AssetSearch from "@/components/shell/AssetSearch";
import NotificationBell from "@/components/notifications/NotificationBell";
import { useNow } from "@/lib/client/hooks/useNow";

type NavPage = { href: string; label: string; match: (path: string) => boolean };
type NavGroup = { label: string; pages: NavPage[] };

/** Four places in the masthead; a section with more than one page shows them in the strip underneath. */
const NAV_GROUPS: NavGroup[] = [
  { label: "Markets", pages: [{ href: "/", label: "Markets", match: (p) => p === "/" || p.startsWith("/market") || p === "/setup" }] },
  {
    label: "Trade",
    pages: [
      { href: "/paper", label: "Paper", match: (p) => p.startsWith("/paper") },
      { href: "/sessions", label: "Sessions", match: (p) => p.startsWith("/sessions") },
      { href: "/alerts", label: "Alerts", match: (p) => p.startsWith("/alerts") },
    ],
  },
  {
    label: "Review",
    pages: [
      { href: "/performance", label: "Performance", match: (p) => p.startsWith("/performance") },
      { href: "/journal", label: "Journal", match: (p) => p.startsWith("/journal") },
      { href: "/archive", label: "Archive", match: (p) => p.startsWith("/archive") },
    ],
  },
  { label: "Learn", pages: [{ href: "/academy", label: "Academy", match: (p) => p.startsWith("/academy") }] },
];

/** Bulletin time: every plan is stamped in UTC, so the masthead keeps the same clock. */
function UtcClock() {
  const now = useNow();
  const hhmm = now ? now.toISOString().slice(11, 16) : "--:--";
  return (
    <span className="hidden font-mono text-[11px] font-semibold tracking-[0.06em] text-ink-3 lg:inline" aria-label={`UTC time ${hhmm}`}>
      {hhmm} UTC
    </span>
  );
}

/** Masthead mark: a closed isobar (pressure centre) cut by a rising price path. */
export function BulletinMark({ className = "" }: { className?: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className={className}>
      <ellipse cx="11" cy="11" rx="9.5" ry="9.5" className="stroke-ink" strokeWidth="1.5" fill="none" />
      <ellipse cx="11" cy="11" rx="5.5" ry="4" className="stroke-accent" strokeWidth="1.5" fill="none" />
      <path d="M3.5 15.5 L8.5 10.5 L12 13 L18.5 6" className="stroke-ink" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NavBar() {
  const pathname = usePathname() ?? "/";
  const activeGroup = NAV_GROUPS.find((g) => g.pages.some((page) => page.match(pathname)));
  const subPages = activeGroup && activeGroup.pages.length > 1 ? activeGroup.pages : null;

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 border-b-2 border-ink bg-paper px-4 pt-2 md:h-14 md:flex-nowrap md:gap-x-8 md:px-6 md:pt-0">
        <Link href="/" aria-label="AlphaBoard home" className="flex items-center gap-2 pb-2 text-[17px] font-extrabold tracking-[-0.02em] text-ink md:pb-0">
          <BulletinMark />
          <span className="md:max-lg:hidden">AlphaBoard</span>
        </Link>

        {/* Phones: the four sections take their own row under the logo and icons. */}
        <nav aria-label="Main" className="order-last -mx-2.5 flex w-full items-stretch self-stretch md:order-none md:mx-0 md:w-auto">
          {NAV_GROUPS.map((group) => {
            const active = group === activeGroup;
            return (
              <Link
                key={group.label}
                href={group.pages[0].href}
                aria-current={active && !subPages ? "page" : undefined}
                className={`relative flex items-center px-2.5 py-2 text-[13px] font-semibold transition-colors sm:px-3 md:py-0 ${active ? "text-ink after:absolute after:inset-x-2 after:-bottom-0.5 after:h-[3px] after:bg-accent" : "text-ink-2 hover:text-ink"}`}
              >
                {group.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 pb-2 sm:gap-3 md:pb-0">
          <UtcClock />
          <AssetSearch />
          <NotificationBell />
          <AccountMenu />
        </div>
      </header>

      {subPages && activeGroup && (
        <nav aria-label={activeGroup.label} className="flex shrink-0 gap-1 border-b border-line bg-paper px-4 md:px-6">
          {subPages.map((page) => {
            const active = page.match(pathname);
            return (
              <Link
                key={page.href}
                href={page.href}
                aria-current={active ? "page" : undefined}
                className={`border-b-2 px-2.5 py-2 text-[12px] font-semibold transition-colors ${active ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink"}`}
              >
                {page.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
