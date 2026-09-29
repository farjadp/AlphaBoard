/** Session report: metrics computed in code (pure) + an AI-written narrative (spec §4.8). */
import type { SessionMetrics } from "@/lib/types/sessions";

export interface ClosedTrade {
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  /** Quantity at open (partial closes shrink the position's qty). */
  openedQty: number;
  initialStop: number | null;
  /** Net of fees. */
  realizedPnl: number;
  closedAt: number;
}

export interface MetricsInput {
  capital: number;
  grossPnl: number;
  fees: number;
  llmCostUsd: number;
  trades: ClosedTrade[];
  rejectionReasons: string[];
  buyAndHold: { symbol: string; startPrice: number | null; endPrice: number | null } | null;
  startedAt: number;
  endedAt: number;
  cycles: number;
}

/** Group rejection reasons by their wording without the numbers ("max trades … reached (6/6)" → one bucket). */
export function reasonKey(reason: string): string {
  return reason
    .replace(/\(.*?\)/g, "")
    .replace(/\$?[\d][\d.,]*%?x?/g, "")
    .replace(/[→:]+.*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

export function computeMetrics(i: MetricsInput): SessionMetrics {
  const netPnl = i.grossPnl - i.fees;
  const sorted = [...i.trades].sort((a, b) => a.closedAt - b.closedAt);
  const wins = sorted.filter((t) => t.realizedPnl > 0).length;
  const losses = sorted.filter((t) => t.realizedPnl < 0).length;
  const rs = sorted.flatMap((t) => {
    if (t.initialStop == null) return [];
    const risk = Math.abs(t.entryPrice - t.initialStop) * t.openedQty;
    return risk > 0 ? [t.realizedPnl / risk] : [];
  });
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const t of sorted) {
    equity += t.realizedPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const buckets = new Map<string, number>();
  for (const r of i.rejectionReasons) {
    const k = reasonKey(r);
    if (k) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const bh = i.buyAndHold;
  return {
    capital: i.capital,
    netPnl,
    grossPnl: i.grossPnl,
    fees: i.fees,
    llmCostUsd: i.llmCostUsd,
    netAfterLlm: netPnl - i.llmCostUsd,
    returnPct: i.capital > 0 ? (netPnl / i.capital) * 100 : 0,
    trades: sorted.length,
    wins,
    losses,
    winRate: sorted.length ? wins / sorted.length : null,
    expectancyR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    maxDrawdown,
    buyAndHold: bh && bh.startPrice && bh.endPrice
      ? { symbol: bh.symbol, startPrice: bh.startPrice, endPrice: bh.endPrice, returnPct: ((bh.endPrice - bh.startPrice) / bh.startPrice) * 100 }
      : null,
    rejections: [...buckets.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    durationMin: Math.max(0, Math.round((i.endedAt - i.startedAt) / 60_000)),
    cycles: i.cycles,
  };
}

const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;

/** Plain-text facts handed to the report writer (it must not recompute numbers). */
export function metricsText(name: string, m: SessionMetrics, trades: Array<ClosedTrade & { reason: string | null }>): string {
  return [
    `Session: ${name} · ${m.durationMin} min · ${m.cycles} decision cycles`,
    `Capital ${usd(m.capital)} · net P&L ${usd(m.netPnl)} (${m.returnPct.toFixed(2)}%) · gross ${usd(m.grossPnl)} · fees ${usd(m.fees)} · AI cost ${usd(m.llmCostUsd)} · net after AI ${usd(m.netAfterLlm)}`,
    `Trades ${m.trades} · wins ${m.wins} · losses ${m.losses} · win rate ${m.winRate == null ? "n/a" : `${Math.round(m.winRate * 100)}%`} · expectancy ${m.expectancyR == null ? "n/a" : `${m.expectancyR.toFixed(2)}R`} · max drawdown ${usd(m.maxDrawdown)}`,
    m.buyAndHold ? `Buy-and-hold ${m.buyAndHold.symbol} over the same window: ${m.buyAndHold.returnPct.toFixed(2)}%` : "Buy-and-hold: unavailable",
    "Trades:",
    ...(trades.length ? trades.map((t) => `- ${t.side} ${t.symbol} @ ${t.entryPrice} → net ${usd(t.realizedPnl)} (${t.reason ?? "closed"})`) : ["- none"]),
    "Risk-engine rejections:",
    ...(m.rejections.length ? m.rejections.map((r) => `- ${r.reason} ×${r.count}`) : ["- none"]),
  ].join("\n");
}
