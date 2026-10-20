import { describe, it, expect } from "vitest";
import { makeBars } from "@/lib/lab/bars";
import { runAccount, type MoneyRules } from "@/lib/lab/account";
import { maxDrawdownPct, perYearPct, profitFactor } from "@/lib/lab/metrics";
import type { SetResult } from "@/lib/lab/ladder";

const MIN = 60_000;
const DAY0 = Date.UTC(2026, 9, 19, 9, 0); // Monday 09:00 UTC
/** One bar per minute for two days. */
const bars = makeBars(Array.from({ length: 2 * 1440 }, (_, i) => [DAY0 + i * MIN, 1, 1, 1, 1] as const));
const NEXT_DAY = (Date.UTC(2026, 9, 20) - DAY0) / MIN; // bar index of Tuesday 00:00

const rules = (o: Partial<MoneyRules> = {}): MoneyRules => ({ riskPct: 1, slots: 1, dailyLossPct: null, maxConsecLosses: 0, cooldownMin: 0, martingale: false, ...o });
/** A set that lasts `len` bars and wins or loses its whole worst case (worst = 10 price units). */
const outcome = (win: boolean, len = 5, mae?: number) => (i: number): SetResult => ({
  kind: win ? "A" : "STOP", pnl: win ? 10 : -10, exit: i + len, worst: 10, mae: mae ?? (win ? 0 : -10), returned: null,
});
const always = (s: (i: number) => SetResult) => (i: number) => s(i);
const up = () => 1 as const;

describe("lab account — money management", () => {
  it("fixed risk: a full loss costs exactly riskPct of the balance, a full win adds it", () => {
    const lose = runAccount(bars, [0], up, always(outcome(false)), rules());
    expect(lose.finalBalance).toBeCloseTo(990, 9);
    const win = runAccount(bars, [0, 10], up, always(outcome(true)), rules());
    expect(win.finalBalance).toBeCloseTo(1000 * 1.01 * 1.01, 9); // compounding
    expect(win.trades).toBe(2);
  });

  it("one slot: an entry while a set is open is skipped; three slots split the risk", () => {
    const one = runAccount(bars, [0, 1, 2], up, always(outcome(false, 100)), rules());
    expect(one.trades).toBe(1);
    const three = runAccount(bars, [0, 1, 2, 3], up, always(outcome(false, 100)), rules({ slots: 3 }));
    expect(three.trades).toBe(3);
    // each risks 1/3 % of 1000 → three full losses ≈ −10
    expect(three.finalBalance).toBeCloseTo(990, 6);
  });

  it("stops for the rest of the UTC day after N losses in a row, starts again the next day", () => {
    const r = runAccount(bars, [0, 10, 20, 30, NEXT_DAY + 5], up, always(outcome(false)), rules({ maxConsecLosses: 2 }));
    expect(r.trades).toBe(3); // 0, 10, then blocked at 20 and 30, open again on Tuesday
  });

  it("daily loss lock", () => {
    const r = runAccount(bars, [0, 10, 20, 30], up, always(outcome(false)), rules({ riskPct: 1.5, dailyLossPct: 2 }));
    // −1.5 % then −1.5 % (≥ 2 % down) → locked for the day
    expect(r.trades).toBe(2);
  });

  it("cooldown after a loss counts from the exit", () => {
    // first set exits at bar 5 (a loss); 20 min later is too early, 40 min later is fine
    const r = runAccount(bars, [0, 25, 45], up, always(outcome(false)), rules({ cooldownMin: 30 }));
    expect(r.trades).toBe(2);
  });

  it("martingale doubles the risk after a loss and resets after a win", () => {
    const seq = [false, false, true];
    let k = 0;
    const sim = (i: number) => outcome(seq[k++])(i);
    const r = runAccount(bars, [0, 10, 20], up, sim, rules({ martingale: true }));
    // −1 %, −2 %, +4 %
    expect(r.finalBalance).toBeCloseTo(1000 * 0.99 * 0.98 * 1.04, 6);
  });

  it("skips bars without a direction and counts wins / profit factor", () => {
    const dir = (i: number) => (i === 10 ? 0 : 1) as -1 | 0 | 1;
    let k = 0;
    const r = runAccount(bars, [0, 10, 20], dir, (i) => outcome([true, false][k++])(i), rules());
    expect(r.trades).toBe(2);
    expect(r.winRate).toBe(0.5);
    expect(r.profitFactor).toBeCloseTo(10 / 10.1, 6);
  });

  it("the open-position drawdown is at least the realized one and uses the worst open P&L", () => {
    const r = runAccount(bars, [0, 10], up, always(outcome(true, 5, -9)), rules());
    expect(r.maxDdRealizedPct).toBe(0);
    expect(r.maxDdMtmPct).toBeCloseTo(0.9, 6); // −9/10 of 1 % risk while open
  });
});

describe("lab metrics", () => {
  it("max drawdown in percent of the peak", () => {
    expect(maxDrawdownPct([100, 120, 90, 130, 117])).toBeCloseTo(25, 9);
    expect(maxDrawdownPct([])).toBe(0);
  });
  it("per-year returns from a balance curve", () => {
    const y = (yr: number, m: number) => Date.UTC(yr, m, 1);
    expect(perYearPct([[y(2025, 0), 1000], [y(2025, 6), 1100], [y(2026, 2), 990]], 1000)).toEqual({ "2025": 10, "2026": -10 });
  });
  it("profit factor", () => {
    expect(profitFactor([3, -1, -2, 1])).toBeCloseTo(4 / 3, 9);
    expect(profitFactor([])).toBeNull();
    expect(profitFactor([1, 2])).toBeNull();
  });
});
