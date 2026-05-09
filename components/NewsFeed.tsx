"use client";

import { useEffect, useState } from "react";
import { findAsset } from "@/lib/assetCatalog";

interface NewsItem {
  id: number;
  time: string;
  source: string;
  headline: string;
  sentiment: "bullish" | "bearish" | "neutral";
  tags: string[];
}

interface NewsFeedProps {
  symbol: string;
}

export default function NewsFeed({ symbol }: NewsFeedProps) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string>("mock");

  const asset = findAsset(symbol);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems([]);

    async function fetchNews() {
      try {
        const res = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`);
        const data = await res.json();
        if (cancelled) return;
        setItems(data.items ?? []);
        setSource(data.source ?? "mock");
      } catch {
        // keep whatever is already shown
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchNews();
    const id = setInterval(fetchNews, 180_000); // refresh every 3 min
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol]);

  const sourceLabel =
    source === "newsapi"     ? { text: "newsapi.org",   color: "var(--green)" }   :
    source === "cryptopanic" ? { text: "CryptoPanic",   color: "var(--green)" }   :
    source === "yahoo"       ? { text: "Yahoo Finance", color: "var(--accent)" }  :
                               { text: "demo data",     color: "var(--text-3)" };

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: "12px" }}>📰</span>
          <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
            News — {asset?.name ?? symbol}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium" style={{ color: sourceLabel.color }}>
            {sourceLabel.text}
          </span>
          {!loading && (
            <span className="text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>
              {items.length} items
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div>
          {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      ) : (
        <div>
          {items.map((item, i) => <NewsRow key={item.id} item={item} index={i} />)}
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-xs" style={{ color: "var(--text-3)" }}>
              No news available for {asset?.name ?? symbol}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewsRow({ item, index }: { item: NewsItem; index: number }) {
  const sentimentColor =
    item.sentiment === "bullish" ? "var(--green)" :
    item.sentiment === "bearish" ? "var(--red)" :
    "var(--yellow)";

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-all duration-150 animate-fade-up"
      style={{ borderBottom: "1px solid var(--border)", animationDelay: `${index * 40}ms` }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{
        background: sentimentColor,
        boxShadow: `0 0 6px ${sentimentColor}`,
      }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-5 font-medium" style={{ color: "var(--text)" }}>{item.headline}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-[11px] font-medium" style={{ color: "var(--text-2)" }}>{item.source}</span>
          <span className="text-[11px]" style={{ color: "var(--text-3)" }}>·</span>
          <span className="text-[11px]" style={{ color: "var(--text-3)" }}>{item.time}</span>
          {item.tags.map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0 skeleton" />
      <div className="flex-1 space-y-2">
        <div className="h-3 skeleton" style={{ width: "85%" }} />
        <div className="h-3 skeleton" style={{ width: "40%" }} />
      </div>
    </div>
  );
}
