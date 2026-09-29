import { describe, it, expect } from "vitest";
import { trackRecord } from "@/lib/eval/trackRecord";
import type { ArchivedSignal } from "@/lib/types/userData";

let n = 0;
const sig = (over: Partial<ArchivedSignal> & { ev?: ArchivedSignal["evaluation"] }): ArchivedSignal => ({
  id: `s${++n}`, timestamp: new Date(Date.UTC(2026, 8, 1, n)).toISOString(), symbol: "BTC/USDT", price: 100, signal: "BUY",
  confidence: 70, timeframe: "1H", entry: 100, stopLoss: 95, takeProfit: 110, reasoning: "r", evaluation: over.ev, ...over,
});
const ev = (status: NonNullable<ArchivedSignal["evaluation"]>["status"], r: number | null) => ({ status, rMultiple: r, resolvedAt: status === "OPEN" ? null : new Date(Date.UTC(2026, 8, 2, n)).toISOString(), note: null });

describe("trackRecord", () => {
  const history = [
    sig({ ev: ev("TP_HIT", 2) }),
    sig({ ev: ev("SL_HIT", -1) }),
    sig({ ev: ev("OPEN", null) }),
    sig({ signal: "HOLD" }),
    sig({ ev: ev("NO_FILL", null) }),
    sig({ timeframe: "4H", ev: ev("TP_HIT", 3) }),
    sig({ symbol: "ETH/USDT", ev: ev("SL_HIT", -1) }),
  ];

  it("scores only this symbol and timeframe, BUY/SELL only, with the same metrics as Performance", () => {
    const r = trackRecord(history, "BTC/USDT", "1H");
    expect(r).toMatchObject({ graded: 2, wins: 1, open: 1, noFill: 1 });
    expect(r.winRate).toBeCloseTo(50, 10);
    expect(r.expectancyR).toBeCloseTo(0.5, 10);
    expect(r.totalR).toBeCloseTo(1, 10);
  });

  it("lists the latest outcomes oldest → newest (max 10) for the dots, open ones included", () => {
    const r = trackRecord(history, "BTC/USDT", "1H");
    expect(r.recent.map((x) => x.status)).toEqual(["TP_HIT", "SL_HIT", "OPEN", "NO_FILL"]);
    const many = Array.from({ length: 14 }, () => sig({ ev: ev("SL_HIT", -1) }));
    expect(trackRecord(many, "BTC/USDT", "1H").recent).toHaveLength(10);
  });

  it("is empty (not zero-filled) when nothing has been graded", () => {
    const r = trackRecord([], "SPX", "1D");
    expect(r).toMatchObject({ graded: 0, winRate: null, expectancyR: null, recent: [] });
  });
});
