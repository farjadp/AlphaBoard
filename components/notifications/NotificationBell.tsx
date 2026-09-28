"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86_400 ? `${Math.floor(s / 3600)}h ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export default function NotificationBell() {
  const { items, unread, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const openItem = (n: AppNotification) => {
    if (!n.readAt) void markRead([n.id]);
    setOpen(false);
    if (n.data?.href) router.push(n.data.href);
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[var(--red)] px-1 text-center text-[10px] font-bold leading-4 text-[var(--bg)]">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-10 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-2)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
            <p className="text-sm font-semibold text-[var(--text)]">Notifications</p>
            {unread > 0 && <button type="button" onClick={() => markRead("all")} className="text-xs text-[var(--accent)] hover:underline">Mark all read</button>}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-[var(--text-3)]">Nothing yet. Price alerts and paper stop/target closes show up here.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className="border-b border-[var(--border)] last:border-0">
                  <button type="button" onClick={() => openItem(n)} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-[var(--surface-hover)]">
                    <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-[var(--accent)]"}`} />
                    <span className="min-w-0">
                      <span className={`block text-xs ${n.readAt ? "text-[var(--text-2)]" : "font-semibold text-[var(--text)]"}`}>{n.title}</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-3)]">{n.body}</span>
                      <span className="mt-1 block text-[10px] text-[var(--text-3)]">{ago(n.createdAt)}{!n.readAt && <span className="sr-only"> · unread</span>}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
