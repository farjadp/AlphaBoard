"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "System", exact: true },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/invites", label: "Invites" },
  { href: "/admin/ai", label: "AI" },
];

export default function AdminNav({ pendingRequests }: { pendingRequests: number }) {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="Admin" className="flex gap-1 text-[13px] font-semibold">
      {LINKS.map((l) => {
        const active = l.exact ? path === l.href : path.startsWith(l.href);
        return (
          <Link
            key={l.href} href={l.href} aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${active ? "bg-ink text-paper" : "text-ink-2 hover:bg-wash hover:text-ink"}`}
          >
            {l.label}
            {l.href === "/admin/invites" && pendingRequests > 0 && (
              <span className={`rounded-full px-1.5 text-[10px] leading-4 ${active ? "bg-paper text-ink" : "bg-accent text-paper"}`} aria-label={`${pendingRequests} access requests waiting`}>
                {pendingRequests}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
