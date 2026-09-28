"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AccountMenu from "@/components/account/AccountMenu";
import AssetSearch from "@/components/shell/AssetSearch";

const NAV_LINKS: Array<{ href: string; label: string; match: (path: string) => boolean }> = [
  { href: "/", label: "Markets", match: (p) => p === "/" || p.startsWith("/market") || p === "/setup" },
  { href: "/paper", label: "Paper", match: (p) => p.startsWith("/paper") },
  { href: "/performance", label: "Performance", match: (p) => p.startsWith("/performance") },
  { href: "/journal", label: "Journal", match: (p) => p.startsWith("/journal") },
  { href: "/archive", label: "Archive", match: (p) => p.startsWith("/archive") },
  { href: "/alerts", label: "Alerts", match: (p) => p.startsWith("/alerts") },
  { href: "/academy", label: "Academy", match: (p) => p.startsWith("/academy") },
];

export default function NavBar() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-1 border-b border-line bg-paper px-4 py-2 md:h-14 md:flex-nowrap md:px-6 md:py-0">
      <Link href="/" className="flex items-center gap-2 font-display text-[17px] font-extrabold text-ink">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect width="20" height="20" rx="5" className="fill-ink" />
          <path d="M4 14 L8 9 L11 11.5 L16 5" className="stroke-paper" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        AlphaBoard
      </Link>

      <nav aria-label="Main" className="-mx-1 order-last flex w-full items-center gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto">
        {NAV_LINKS.map((link) => {
          const active = link.match(pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${active ? "text-ink" : "text-ink-2 hover:bg-wash hover:text-ink"}`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-4">
        <AssetSearch />
        <AccountMenu />
      </div>
    </header>
  );
}
