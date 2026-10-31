/**
 * Golden checks against the 2026-10-20 research (opt-in: LAB_GOLDEN_DIR with the research data).
 * M1_XAUUSD.csv = Farjad's ePlanet broker export (ExportM1.mq5): utc,open,high,low,close,spread_points,point.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runAccount } from "@/lib/lab/account";
import { bucketStarts, holeAfter, makeBars, medianRange, noHoles, trendH4, type Bars } from "@/lib/lab/bars";
import { ladderParams, runLadderSet } from "@/lib/lab/ladder";
import { halfSubset, spread } from "@/lib/lab/robust";
import { runDca, type Cube } from "@/lib/lab/dca";

const DIR = process.env.LAB_GOLDEN_DIR ?? "";
const goldCsv = join(DIR, "M1_XAUUSD.csv");
const hasGold = !!DIR && existsSync(goldCsv);

function loadBroker(path: string): { bars: Bars; spread: number } {
  const lines = readFileSync(path, "utf8").split("\n");
  const rows: Array<[number, number, number, number, number]> = [];
  const spreads: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(",");
    if (f.length < 7) continue;
    rows.push([Number(f[0]) * 1000, Number(f[1]), Number(f[2]), Number(f[3]), Number(f[4])]);
    spreads.push(Number(f[5]) * Number(f[6]));
  }
  spreads.sort((a, b) => a - b);
  return { bars: makeBars(rows), spread: spreads[spreads.length >> 1] };
}

/** Every 15-minute open, 01:00–20:45 UTC, Monday–Friday (the research's entry grid). */
function entryGrid(b: Bars): number[] {
  return Array.from(bucketStarts(b, 15)).filter((i) => {
    const d = new Date(b.t[i]);
    return d.getUTCMinutes() % 15 === 0 && d.getUTCHours() >= 1 && d.getUTCHours() <= 20 && d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
  });
}

describe.skipIf(!hasGold)("lab golden — gold, broker data Oct 2025 – Oct 2026", () => {
  const { bars, spread: medSpread } = hasGold ? loadBroker(goldCsv) : { bars: makeBars([]), spread: 0 };
  // Each check uses the research script's own convention for a set still open at a market closure:
  // sim.py / sweep.py dropped it (holeAfter), account.py / mm.py kept it running (noHoles). The 25 %
  // runner after scenario A has no target, so this choice alone moves the per-set result a lot.
  const holesDrop = holeAfter(bars);
  const holesKeep = noHoles(bars);
  const unit = medianRange(bars, 15);
  const cost = medSpread + 0.1;

  it("the candle unit is about $8", () => {
    expect(unit).toBeGreaterThan(7.5);
    expect(unit).toBeLessThan(8.5);
  });

  it("the 80 % rule: −48 $ per 100 sets at 0.01 lot, price returns to the first entry ~37 % of the time", () => {
    // sim.py: a 3-day wall-clock limit.
    const p = ladderParams(unit, cost, { maxHoldBars: Number.MAX_SAFE_INTEGER, maxHoldMs: 3 * 86_400_000 });
    let sum = 0, n = 0, back = 0, decided = 0;
    for (const i of entryGrid(bars)) {
      for (const d of [1, -1] as const) {
        const r = runLadderSet(bars, holesDrop, i, d, p);
        if (!r) continue;
        sum += r.pnl; n++;
        if (r.returned != null && r.kind !== "OPEN") { decided++; if (r.returned) back++; }
      }
    }
    const per100 = (sum / n) * 100;
    expect(n).toBeGreaterThan(40_000);
    expect(per100).toBeGreaterThan(-52);
    expect(per100).toBeLessThan(-45);
    expect(back / decided).toBeGreaterThan(0.364);
    expect(back / decided).toBeLessThan(0.384);
  }, 120_000);

  it("money management: no P2 + H4 trend + stop after 2 losses + daily lock 2 % + 30 min pause ≈ +17 %/yr, ~29/30 positive", () => {
    const trend = trendH4(bars);
    // account.py: a 3 × 1440-bar limit.
    const p = ladderParams(unit, cost, { p2: null });
    const grid = entryGrid(bars);
    const runs = Array.from({ length: 30 }, (_, seed) => runAccount(
      bars, halfSubset(grid, seed), (i) => trend[i] as -1 | 0 | 1, (i, d) => runLadderSet(bars, holesKeep, i, d, p),
      { riskPct: 0.5, slots: 1, dailyLossPct: 2, maxConsecLosses: 2, cooldownMin: 30, martingale: false },
    ));
    const s = spread(runs.map((r) => r.returnPct));
    expect(s.median).toBeGreaterThan(10);
    expect(s.median).toBeLessThan(24);
    expect(s.positiveShare).toBeGreaterThanOrEqual(26 / 30);
    const dd = spread(runs.map((r) => r.maxDdMtmPct)).median;
    expect(dd).toBeGreaterThan(5);
    expect(dd).toBeLessThan(15);
  }, 120_000);
});

const cubeBin = join(DIR, "binance_1h.bin");
const hasCube = !!DIR && existsSync(cubeBin);

/** Hourly Binance USD-M klines of 129 USDT symbols listed by Jan 2022 (delisted ones included), 2021-01 → 2026-09. */
function loadCube(): Cube {
  const meta = JSON.parse(readFileSync(join(DIR, "binance_1h.json"), "utf8")) as { n: number; t0: number; syms: string[] };
  const buf = readFileSync(cubeBin);
  const all = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  const { n, syms } = meta;
  const m = syms.length;
  const field = (f: number) => syms.map((_, j) => all.subarray((f * m + j) * n, (f * m + j + 1) * n));
  return { t: Float64Array.from({ length: n }, (_, k) => meta.t0 + k * 3_600_000), syms, o: field(0), h: field(1), l: field(2), c: field(3) };
}

describe.skipIf(!hasCube)("lab golden — 'Robi' DCA ladder on Binance futures 2021 → 2026", () => {
  it("reproduces the bot's own depth statistics and the drawdown its realized curve hides", () => {
    const cube = loadCube();
    const r = runDca(cube, {
      slots: 15, deepSlots: 10, drop: 0.03, d1: 0.09, d2: 0.195, sizes: [1, 1.8, 4.7], tp0: 0.015, tp1: 0.01, fee: 0.0005,
      btcLock: 0.05, btcIndex: cube.syms.indexOf("BTCUSDT"), stopLoss: null,
    }, Date.UTC(2021, 0, 1));
    // his backtest: 87.4 / 9.95 / 2.67 %; the research replay: 86.3 / 11.1 / 2.6 %
    expect(r.depthShare[0]).toBeGreaterThan(0.84);
    expect(r.depthShare[0]).toBeLessThan(0.89);
    expect(r.depthShare[2]).toBeLessThan(0.045);
    expect(r.maxDdMtmPct).toBeGreaterThan(80);
    expect(r.maxDdRealizedPct).toBeLessThan(15);
    expect(r.perYear["2022"]).toBeLessThan(-50);
    expect(r.perYear["2021"]).toBeGreaterThan(100);
  }, 300_000);
});
