/**
 * The user's own record for one symbol + timeframe, from the archive the client already has
 * (each archived signal carries its P5 evaluation). Same maths as the Performance page.
 */
import type { ArchivedSignal } from "@/lib/types/userData";
import { summarize, type EvaluatedRow } from "./metrics";

export type Outcome = NonNullable<ArchivedSignal["evaluation"]>["status"];

export interface TrackRecord {
  graded: number;
  wins: number;
  open: number;
  noFill: number;
  winRate: number | null;
  expectancyR: number | null;
  totalR: number;
  /** Latest outcomes, oldest → newest, for the dot row. */
  recent: Array<{ id: string; status: Outcome; rMultiple: number | null; at: string; confidence: number }>;
}

const MAX_DOTS = 10;

export function trackRecord(history: ArchivedSignal[], symbol: string, timeframe: string): TrackRecord {
  const mine = history
    .filter((s) => s.symbol === symbol && s.timeframe.toUpperCase() === timeframe.toUpperCase() && (s.signal === "BUY" || s.signal === "SELL"))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const rows: EvaluatedRow[] = mine.map((s) => ({
    status: s.evaluation?.status ?? "OPEN",
    rMultiple: s.evaluation?.rMultiple ?? null,
    resolvedAt: s.evaluation?.resolvedAt ? new Date(s.evaluation.resolvedAt) : null,
    confidence: s.confidence, symbol: s.symbol, timeframe: s.timeframe, model: "",
  }));
  const sum = summarize(rows);
  return {
    graded: sum.trades, wins: sum.wins, open: sum.open, noFill: sum.noFill,
    winRate: sum.winRate, expectancyR: sum.expectancyR, totalR: sum.totalR,
    recent: mine.slice(-MAX_DOTS).map((s) => ({
      id: s.id, status: s.evaluation?.status ?? "OPEN", rMultiple: s.evaluation?.rMultiple ?? null, at: s.timestamp, confidence: s.confidence,
    })),
  };
}
