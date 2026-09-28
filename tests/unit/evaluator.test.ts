import { describe, it, expect } from "vitest";
import { evaluateSignal, HORIZON_BARS, type EvalSignal } from "@/lib/eval/evaluator";

const H = 3_600_000; // 1H bars
const t0 = Date.UTC(2026, 8, 1, 10, 30); // signal at 10:30 → first counted bar starts 11:00
const bar = (i: number, open: number, high: number, low: number, close: number) => ({ time: Date.UTC(2026, 8, 1, 11) + i * H, open, high, low, close });
const pre = { time: Date.UTC(2026, 8, 1, 10), open: 100, high: 130, low: 70, close: 100 }; // contains the signal time: ignored
const buy: EvalSignal = { signal: "BUY", timeframe: "1H", createdAt: new Date(t0), priceAtSignal: 100, entry: 100, stopLoss: 95, takeProfit: 110 };
const sell: EvalSignal = { ...buy, signal: "SELL", stopLoss: 105, takeProfit: 90 };
const far = new Date(Date.UTC(2026, 9, 1));

describe("evaluateSignal", () => {
  it("skips HOLD signals", () => {
    expect(evaluateSignal({ ...buy, signal: "HOLD" }, [pre], far)).toBeNull();
  });

  it("marks levels on the wrong side as invalid", () => {
    expect(evaluateSignal({ ...buy, stopLoss: 101 }, [pre], far)).toMatchObject({ status: "INVALID", note: expect.stringMatching(/levels/i) });
  });

  it("marks signals older than the available history as invalid", () => {
    expect(evaluateSignal(buy, [bar(0, 100, 101, 99, 100)], far)).toMatchObject({ status: "INVALID", note: expect.stringMatching(/history/i) });
  });

  it("stays OPEN while price is between stop and target", () => {
    const r = evaluateSignal(buy, [pre, bar(0, 100, 104, 97, 101)], new Date(Date.UTC(2026, 8, 1, 12, 30)));
    expect(r).toMatchObject({ status: "OPEN", barsElapsed: 1, rMultiple: null });
    expect(r?.entryFilledAt).toBeTruthy();
  });

  it("resolves TP_HIT with R = reward / risk, ignoring the pre-signal bar", () => {
    const r = evaluateSignal(buy, [pre, bar(0, 100, 104, 97, 103), bar(1, 103, 111, 102, 109)], far);
    expect(r).toMatchObject({ status: "TP_HIT", rMultiple: 2, exitPrice: 110, barsElapsed: 2 });
    expect(r?.resolvedAt?.getTime()).toBe(bar(1, 0, 0, 0, 0).time);
  });

  it("resolves SL_HIT at −1R, and worse than −1R when the bar gaps through the stop", () => {
    expect(evaluateSignal(buy, [pre, bar(0, 100, 101, 94, 96)], far)).toMatchObject({ status: "SL_HIT", rMultiple: -1 });
    expect(evaluateSignal(buy, [pre, bar(0, 100, 101, 99, 100), bar(1, 93, 94, 90, 92)], far)).toMatchObject({ status: "SL_HIT", rMultiple: -1.4, exitPrice: 93 });
  });

  it("assumes the stop when one bar spans both levels", () => {
    expect(evaluateSignal(buy, [pre, bar(0, 100, 112, 94, 100)], far)?.status).toBe("SL_HIT");
  });

  it("evaluates SELL signals symmetrically", () => {
    expect(evaluateSignal(sell, [pre, bar(0, 100, 101, 89, 90)], far)).toMatchObject({ status: "TP_HIT", rMultiple: 2 });
    expect(evaluateSignal(sell, [pre, bar(0, 100, 106, 99, 104)], far)).toMatchObject({ status: "SL_HIT", rMultiple: -1 });
  });

  it("waits for a limit entry away from the price; only the stop counts on the fill bar", () => {
    const limit = { ...buy, entry: 98, stopLoss: 94, takeProfit: 106 }; // risk 4
    const notYet = evaluateSignal(limit, [pre, bar(0, 100, 107, 99, 105)], new Date(Date.UTC(2026, 8, 1, 12, 30)));
    expect(notYet).toMatchObject({ status: "OPEN", entryFilledAt: null }); // TP traded before the entry filled: no credit
    const fillBar = evaluateSignal(limit, [pre, bar(0, 100, 107, 97, 105)], far);
    expect(fillBar?.status).not.toBe("TP_HIT"); // TP in the fill bar is ambiguous → not counted
    const later = evaluateSignal(limit, [pre, bar(0, 100, 101, 97, 99), bar(1, 99, 107, 98, 106)], far);
    expect(later).toMatchObject({ status: "TP_HIT", rMultiple: 2 });
  });

  it("expires after the horizon: EXPIRED with the close-based R if filled, NO_FILL otherwise", () => {
    const n = HORIZON_BARS["1H"];
    const flat = Array.from({ length: n + 5 }, (_, i) => bar(i, 100, 102, 98, i === n - 1 ? 102.5 : 100));
    expect(evaluateSignal(buy, [pre, ...flat], far)).toMatchObject({ status: "EXPIRED", rMultiple: 0.5, barsElapsed: n, exitPrice: 102.5 });
    const limit = { ...buy, entry: 90, stopLoss: 85, takeProfit: 100 };
    expect(evaluateSignal(limit, [pre, ...flat], far)).toMatchObject({ status: "NO_FILL", rMultiple: null });
  });

  it("does not expire on a horizon bar that is still forming", () => {
    const n = HORIZON_BARS["1H"];
    const flat = Array.from({ length: n }, (_, i) => bar(i, 100, 102, 98, 100));
    const midLastBar = new Date(flat.at(-1)!.time + 10 * 60_000);
    expect(evaluateSignal(buy, [pre, ...flat], midLastBar)?.status).toBe("OPEN");
  });

  it("accepts legacy timeframe spellings and rejects unknown ones", () => {
    expect(evaluateSignal({ ...buy, timeframe: "1h" }, [pre, bar(0, 100, 111, 99, 110)], far)?.status).toBe("TP_HIT");
    expect(evaluateSignal({ ...buy, timeframe: "Swing" }, [pre], far)).toMatchObject({ status: "INVALID", note: expect.stringMatching(/timeframe/i) });
  });
});
