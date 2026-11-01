"use client";

import { useEffect, useState } from "react";

export type ColorScheme = "light" | "dark";

/** The scheme the page is drawn in: `<html data-theme>` when set, else the OS preference. Updates live. */
export function currentColorScheme(): ColorScheme {
  if (typeof document === "undefined") return "light";
  const pinned = document.documentElement.dataset.theme;
  if (pinned === "light" || pinned === "dark") return pinned;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>("light");
  useEffect(() => {
    const update = () => setScheme(currentColorScheme());
    update();
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { media?.removeEventListener("change", update); observer.disconnect(); };
  }, []);
  return scheme;
}
