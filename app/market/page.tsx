"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWatchlist } from "@/hooks/useWatchlist";
import { assetHref, DEFAULT_WATCHLIST } from "@/lib/assetCatalog";

export default function MarketIndexPage() {
  const router = useRouter();
  const { symbols, hydrated } = useWatchlist();

  useEffect(() => {
    if (!hydrated) return;
    router.replace(assetHref(symbols[0] ?? DEFAULT_WATCHLIST[0]));
  }, [hydrated, router, symbols]);

  return <div className="min-h-screen" style={{ background: "var(--bg)" }} />;
}
