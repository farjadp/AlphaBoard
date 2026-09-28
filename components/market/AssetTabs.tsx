"use client";

import Link from "next/link";
import { formatPrice, type BinanceTicker } from "@/lib/binance";
import { assetHref, type Asset } from "@/lib/assetCatalog";
import type { TradfiQuoteMap } from "@/hooks/useTradfiQuotes";
import { useCandles } from "@/hooks/useCandles";
import Sparkline from "./Sparkline";

interface AssetTabsProps {
  watchlist: Asset[];
  selected: string;
  tickers: Record<string, BinanceTicker>;
  tradfiQuotes: TradfiQuoteMap;
}

/** The watchlist as tabs across the top: price, 24h change and a 24h sparkline per symbol. */
export default function AssetTabs({ watchlist, selected, tickers, tradfiQuotes }: AssetTabsProps) {
  return (
    <nav aria-label="Watchlist" className="flex overflow-x-auto border-b border-line bg-paper">
      {watchlist.map((asset) => {
        const live = asset.binanceSymbol ? tickers[asset.binanceSymbol] : undefined;
        const quote = tradfiQuotes[asset.symbol];
        return (
          <AssetTab
            key={asset.symbol}
            asset={asset}
            active={asset.symbol === selected}
            price={live?.price ?? quote?.price}
            change={live?.change ?? quote?.change}
          />
        );
      })}
      <Link href="/setup" className="flex shrink-0 items-center px-5 text-[13px] font-bold text-accent hover:bg-wash">
        {watchlist.length === 0 ? "+ Add symbols" : "Edit"}
      </Link>
    </nav>
  );
}

function AssetTab({ asset, active, price, change }: { asset: Asset; active: boolean; price?: number; change?: number }) {
  const { candles } = useCandles(asset.symbol, "1H", 300_000);
  const closes = candles.slice(-24).map((c) => c.close);
  const hasPrice = price !== undefined && price > 0;
  const hasChange = change !== undefined && hasPrice;
  const up = (change ?? 0) >= 0;

  return (
    <Link
      href={assetHref(asset.symbol)}
      aria-current={active ? "page" : undefined}
      className={`relative grid min-w-44 flex-1 shrink-0 grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-r border-line px-5 py-3 ${active ? "bg-wash after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-ink" : "hover:bg-wash"}`}
    >
      <span className="text-[13px] font-extrabold text-ink">{asset.symbol}</span>
      <Sparkline values={closes} className={`row-span-2 self-center ${up ? "text-up" : "text-down"}`} />
      <span className="flex gap-2 text-xs">
        <span className="num text-ink-2">{hasPrice ? formatPrice(price) : "—"}</span>
        {hasChange && <span className={`num ${up ? "text-up" : "text-down"}`}>{up ? "+" : "−"}{Math.abs(change).toFixed(2)}%</span>}
      </span>
    </Link>
  );
}
