"use client";

import { useColorScheme, type ColorScheme } from "@/lib/client/hooks/useColorScheme";

const STORAGE_KEY = "alphaboard.theme";

/** Day chart / radar night switch. The choice is pinned on <html data-theme> and remembered per browser. */
export default function ThemeToggle() {
  const scheme = useColorScheme();
  const next: ColorScheme = scheme === "dark" ? "light" : "dark";

  function flip() {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage blocked: the pin lasts for this page */ }
  }

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={next === "dark" ? "Switch to dark theme" : "Switch to light theme"}
      title={next === "dark" ? "Radar night (dark)" : "Day chart (light)"}
      className="grid size-8 place-items-center rounded-[3px] border border-line text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
    >
      {scheme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" />
        </svg>
      )}
    </button>
  );
}
