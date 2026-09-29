"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { createResource, resetAllResources, useResource } from "@/lib/client/resource";

type Me = { id: string; email: string; name: string | null; role: "USER" | "ADMIN" } | null;
const meResource = createResource<Me>("/api/me", { fallback: null, select: (j) => (j as { user: Me }).user });

export default function AccountMenu() {
  const { data: me } = useResource(meResource);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function signOut() {
    setBusy(true);
    await signOutAction();
    resetAllResources();
    window.location.assign("/login"); // full reload: nothing from this account stays in memory
  }

  const initial = (me?.name || me?.email || "?").charAt(0).toUpperCase();

  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded-full text-[12px] font-extrabold flex items-center justify-center bg-accent-soft text-accent hover:bg-accent-soft-hover"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-50 w-60 rounded-xl border border-line bg-paper p-1 shadow-lg text-[13px]">
          <div className="px-3 py-2 border-b border-line mb-1">
            <p className="font-bold text-ink truncate">{me?.name ?? "Signed in"}</p>
            <p className="text-ink-3 truncate">{me?.email}</p>
          </div>
          <Link role="menuitem" href="/settings" className="block rounded-lg px-3 py-2 text-ink-2 hover:bg-wash hover:text-ink">Settings · AI model</Link>
          <Link role="menuitem" href="/import" className="block rounded-lg px-3 py-2 text-ink-2 hover:bg-wash hover:text-ink">Import browser data</Link>
          {me?.role === "ADMIN" && (
            <Link role="menuitem" href="/admin" className="block rounded-lg px-3 py-2 text-ink-2 hover:bg-wash hover:text-ink">Admin · System, users, invites, AI</Link>
          )}
          <button role="menuitem" type="button" disabled={busy} onClick={signOut} className="w-full text-left rounded-lg px-3 py-2 text-down hover:bg-down-soft disabled:opacity-50">
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
