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
        className="w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center border border-white/15 bg-white/5 text-gray-200 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-50 w-56 rounded-xl border border-white/10 bg-gray-900 p-1 shadow-xl text-xs">
          <div className="px-3 py-2 border-b border-white/10 mb-1">
            <p className="font-semibold text-gray-100 truncate">{me?.name ?? "Signed in"}</p>
            <p className="text-gray-400 truncate">{me?.email}</p>
          </div>
          <Link role="menuitem" href="/import" className="block rounded-lg px-3 py-2 text-gray-200 hover:bg-white/5">Import browser data</Link>
          {me?.role === "ADMIN" && (
            <Link role="menuitem" href="/admin/invites" className="block rounded-lg px-3 py-2 text-gray-200 hover:bg-white/5">Admin · Invites</Link>
          )}
          <button role="menuitem" type="button" disabled={busy} onClick={signOut} className="w-full text-left rounded-lg px-3 py-2 text-red-300 hover:bg-red-500/10 disabled:opacity-50">
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
