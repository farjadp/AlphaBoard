"use client";

import { useSyncExternalStore } from "react";

// One shared 1s ticker for every clock on the page; null during SSR/hydration (no mismatch).
let now = Math.floor(Date.now() / 1000);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      now = Math.floor(Date.now() / 1000);
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

/** Current time as a Date, ticking once per second; null on the server. */
export function useNow(): Date | null {
  const seconds = useSyncExternalStore(subscribe, () => now, () => null);
  return seconds === null ? null : new Date(seconds * 1000);
}
