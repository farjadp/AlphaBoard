"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AccountMenu from "@/components/account/AccountMenu";
import AssetSearch from "@/components/shell/AssetSearch";
import NotificationBell from "@/components/notifications/NotificationBell";
import ThemeToggle from "@/components/shell/ThemeToggle";
import { useNow } from "@/lib/client/hooks/useNow";

const NAV_LINKS: Array<{ href: string; label: string; match: (path: string) => boolean }> = [
  { href: "/", label: "Markets", match: (p) => p === "/" || p.startsWith("/market") || p === "/setup" },
  { href: "/paper", label: "Paper", match: (p) => p.startsWith("/paper") },
  { href: "/sessions", label: "Sessions", match: (p) => p.startsWith("/sessions") },
  { href: "/performance", label: "Performance", match: (p) => p.startsWith("/performance") },
  { href: "/journal", label: "Journal", match: (p) => p.startsWith("/journal") },
  { href: "/archive", label: "Archive", match: (p) => p.startsWith("/archive") },
  { href: "/alerts", label: "Alerts", match: (p) => p.startsWith("/alerts") },
  { href: "/academy", label: "Academy", match: (p) => p.startsWith("/academy") },
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

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-1 border-b-2 border-ink bg-paper px-4 pt-2 md:h-14 md:flex-nowrap md:px-6 md:pt-0">
      <Link href="/" aria-label="AlphaBoard home" className="flex items-center gap-2 pb-2 text-[17px] font-extrabold tracking-[-0.02em] text-ink md:pb-0">
        <BulletinMark />
        <span className="hidden min-[420px]:inline">AlphaBoard</span>
      </Link>

      <nav aria-label="Main" className="-mx-1 order-last flex w-full items-stretch gap-0.5 self-stretch overflow-x-auto [scrollbar-width:none] md:order-none md:mx-0 md:w-auto">
        {NAV_LINKS.map((link) => {
          const active = link.match(pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex shrink-0 items-center px-3 py-2 text-[13px] font-semibold transition-colors ${active ? "text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:bg-accent" : "text-ink-2 hover:text-ink"}`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2 pb-2 sm:gap-3 md:pb-0">
        <UtcClock />
        <AssetSearch />
        <ThemeToggle />
        <NotificationBell />
        <AccountMenu />
      </div>
    </header>
  );
}
