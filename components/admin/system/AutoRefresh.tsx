"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render the server page every 30 s while it is visible. */
export default function AutoRefresh({ everyMs = 30_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
