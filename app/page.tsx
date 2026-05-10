"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWatchlist } from "@/hooks/useWatchlist";
import { assetHref, DEFAULT_WATCHLIST, findAsset } from "@/lib/assetCatalog";

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { symbols, hydrated } = useWatchlist();

  useEffect(() => {
    if (!hydrated) return;
    const requestedSymbol = searchParams.get("symbol");
    const resolvedSymbol = requestedSymbol && findAsset(requestedSymbol)
      ? requestedSymbol
      : symbols[0] ?? DEFAULT_WATCHLIST[0];

    router.replace(assetHref(resolvedSymbol));
  }, [hydrated, router, searchParams, symbols]);

  return <div className="min-h-screen" style={{ background: "var(--bg)" }} />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "var(--bg)" }} />}>
      <DashboardContent />
    </Suspense>
  );
}
