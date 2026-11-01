"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ASSET_CATALOG, assetHref } from "@/lib/market/catalog";

/** Symbol jump box. ⌘K / Ctrl+K focuses it from anywhere. */
export default function AssetSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ASSET_CATALOG.slice(0, 8);
    return ASSET_CATALOG.filter((a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(symbol: string) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(assetHref(symbol));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && matches[active]) { e.preventDefault(); go(matches[active].symbol); }
    else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  }

  return (
    <div className="relative w-9 sm:w-72 max-sm:focus-within:fixed max-sm:focus-within:inset-x-4 max-sm:focus-within:top-2.5 max-sm:focus-within:z-50 max-sm:focus-within:w-auto">
      {/* Phones get a magnifier box that opens across the masthead on focus, so the bell and account stay on screen. */}
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3">
        <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" />
      </svg>
      <label htmlFor={`${listId}-input`} className="sr-only">Jump to symbol</label>
      <input
        id={`${listId}-input`}
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        placeholder="Symbol…"
        className="h-9 w-full rounded-md border border-line bg-wash pl-8 pr-2 text-[13px] sm:pr-12 max-sm:placeholder:text-transparent max-sm:focus:placeholder:text-ink-3 text-ink placeholder:text-ink-3 focus:border-accent focus:bg-paper focus:outline-none"
      />
      <kbd className="pointer-events-none absolute hidden sm:block right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-paper px-1.5 font-mono text-[11px] text-ink-3">⌘K</kbd>
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-md border border-line bg-paper py-1 shadow-lg">
          {matches.map((a, i) => (
            <li
              key={a.symbol}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); go(a.symbol); }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-[13px] ${i === active ? "bg-accent-soft" : ""}`}
            >
              <span className="font-bold text-ink">{a.symbol}</span>
              <span className="truncate pl-3 text-ink-3">{a.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
