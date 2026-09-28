/**
 * Aggregate performance of evaluated signals (pure). Only resolved trades with an R (TP_HIT, SL_HIT,
 * EXPIRED) count as trades; OPEN / NO_FILL / INVALID are reported as counts. Metrics that cannot be
 * computed are null — the UI shows "—", never a made-up 0.
 */
import type { SignalOutcome } from "./evaluator";

export interface EvaluatedRow {
  status: SignalOutcome;
  rMultiple: number | null;
  resolvedAt: Date | null;
  confidence: number;
  symbol: string;
  timeframe: string;
  model: string;
}

export interface Summary {
  trades: number;
  wins: number;
  open: number;
  noFill: number;
  invalid: number;
  winRate: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  totalR: number;
  avgWinR: number | null;
  avgLossR: number | null;
  maxDrawdownR: number | null;
}

const isTrade = (r: EvaluatedRow) => (r.status === "TP_HIT" || r.status === "SL_HIT" || r.status === "EXPIRED") && r.rMultiple != null;
const byResolution = (a: EvaluatedRow, b: EvaluatedRow) => (a.resolvedAt?.getTime() ?? 0) - (b.resolvedAt?.getTime() ?? 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function summarize(rows: EvaluatedRow[]): Summary {
  const trades = rows.filter(isTrade).sort(byResolution);
  const rs = trades.map((t) => t.rMultiple!);
  const wins = rs.filter((r) => r > 0), losses = rs.filter((r) => r < 0);
  const lossSum = -losses.reduce((s, r) => s + r, 0);

  let cum = 0, peak = 0, dd = 0;
  for (const r of rs) { cum += r; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }

  return {
    trades: rs.length,
    wins: wins.length,
    open: rows.filter((r) => r.status === "OPEN").length,
    noFill: rows.filter((r) => r.status === "NO_FILL").length,
    invalid: rows.filter((r) => r.status === "INVALID").length,
    winRate: rs.length ? (wins.length / rs.length) * 100 : null,
    expectancyR: mean(rs),
    profitFactor: lossSum > 0 ? wins.reduce((s, r) => s + r, 0) / lossSum : null,
    totalR: rs.reduce((s, r) => s + r, 0),
    avgWinR: mean(wins),
    avgLossR: mean(losses),
    maxDrawdownR: rs.length ? dd : null,
  };
}

/** "gpt-5.4-mini-2026-03-17" → "gpt-5.4-mini": providers report dated snapshots of the same model. */
export const modelFamily = (model: string) => model.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");

export const CONFIDENCE_BUCKETS = ["<50", "50–59", "60–69", "70–79", "80+"] as const;
export type ConfidenceBucket = (typeof CONFIDENCE_BUCKETS)[number];

export function confidenceBucket(c: number): ConfidenceBucket {
  return c < 50 ? "<50" : c < 60 ? "50–59" : c < 70 ? "60–69" : c < 80 ? "70–79" : "80+";
}

function groupBy(rows: EvaluatedRow[], key: (r: EvaluatedRow) => string) {
  const m = new Map<string, EvaluatedRow[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()]
    .map(([k, g]) => ({ key: k, ...summarize(g) }))
    .sort((a, b) => b.trades - a.trades || a.key.localeCompare(b.key));
}

export function performanceReport(rows: EvaluatedRow[]) {
  const trades = rows.filter(isTrade).sort(byResolution);
  let cum = 0;
  const curve = trades.map((t) => ({ at: t.resolvedAt!.toISOString(), cumR: (cum += t.rMultiple!) }));
  const calibration = CONFIDENCE_BUCKETS.map((bucket) => {
    const inBucket = trades.filter((t) => confidenceBucket(t.confidence) === bucket);
    const wins = inBucket.filter((t) => t.rMultiple! > 0).length;
    return {
      bucket,
      trades: inBucket.length,
      avgConfidence: mean(inBucket.map((t) => t.confidence)),
      winRate: inBucket.length ? (wins / inBucket.length) * 100 : null,
    };
  });
  return {
    summary: summarize(rows),
    curve,
    bySymbol: groupBy(rows, (r) => r.symbol),
    byTimeframe: groupBy(rows, (r) => r.timeframe),
    byModel: groupBy(rows, (r) => modelFamily(r.model)),
    byConfidence: groupBy(rows, (r) => confidenceBucket(r.confidence))
      .sort((a, b) => CONFIDENCE_BUCKETS.indexOf(a.key as ConfidenceBucket) - CONFIDENCE_BUCKETS.indexOf(b.key as ConfidenceBucket)),
    calibration,
  };
}

export type PerformanceReport = ReturnType<typeof performanceReport>;
