/**
 * Edge check (pure): do these entries beat random entries? Each real trade is compared with `samples`
 * random entries in the same calendar month on the same data — same side, same stop distance, same
 * holding time; a random entry exits at its stop or after the holding time. Results are in R (the
 * trade's own stop distance), price-based on both sides so the comparison is like for like. The
 * average difference gets a bootstrap 95 % interval: an edge is claimed only when it excludes 0.
 */
import { dirOf, rMultiple } from "@/lib/trading/math";
import type { Bars } from "./bars";
import { mulberry32 } from "./robust";

export interface EdgeTrade {
  side: "LONG" | "SHORT";
  entryTime: number;
  entryPrice: number;
  stop: number | null;
  exitTime: number;
  exitPrice: number;
}

export interface EdgeResult {
  trades: number;
  used: number;
  skippedNoStop: number;
  skippedNoData: number;
  avgR: number | null;
  baselineAvgR: number | null;
  edgeR: number | null;
  ci: [number, number];
  winRate: number | null;
  baselineWinRate: number | null;
  verdict: string[];
}

const MIN_TRADES_FOR_VERDICT = 30;

/** First bar at or after t (binary search); length when none. */
function at(b: Bars, t: number): number {
  let lo = 0, hi = b.t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (b.t[m] < t) lo = m + 1; else hi = m; }
  return lo;
}

/** A random entry at bar i: stop at `dist`, else out at the close after `holdMs`. Returns R. */
function simulate(b: Bars, i: number, dir: 1 | -1, dist: number, holdMs: number): number {
  const E = b.o[i];
  const stop = E - dir * dist;
  const until = b.t[i] + holdMs;
  let k = i;
  for (; k < b.t.length && b.t[k] <= until; k++) {
    const adverse = dir > 0 ? b.l[k] : b.h[k];
    if ((adverse - stop) * dir <= 0) return -1;
  }
  const last = Math.min(k, b.t.length) - 1;
  return ((b.c[last] - E) * dir) / dist;
}

export function edgeCheck(trades: EdgeTrade[], b: Bars, opts: { samples?: number; seed?: number } = {}): EdgeResult {
  const samples = opts.samples ?? 100;
  const rnd = mulberry32(opts.seed ?? 1);
  const first = b.t.length ? b.t[0] : Infinity;
  const lastT = b.t.length ? b.t[b.t.length - 1] : -Infinity;
  let skippedNoStop = 0, skippedNoData = 0;
  const real: number[] = [];
  const base: number[] = [];
  let realWins = 0, baseWins = 0, baseCount = 0;

  for (const tr of trades) {
    if (tr.stop == null || tr.stop === tr.entryPrice) { skippedNoStop++; continue; }
    const holdMs = Math.max(60_000, tr.exitTime - tr.entryTime);
    if (tr.entryTime < first || tr.exitTime > lastT) { skippedNoData++; continue; }
    const dir = dirOf(tr.side);
    const dist = Math.abs(tr.entryPrice - tr.stop);
    const r = rMultiple({ side: tr.side, entry: tr.entryPrice, stop: tr.stop, price: tr.exitPrice })!;
    // random entries in the same calendar month that still have the holding time inside the data
    const d = new Date(tr.entryTime);
    const m0 = at(b, Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const m1 = Math.min(at(b, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)), at(b, lastT - holdMs));
    if (m1 - m0 < 10) { skippedNoData++; continue; }
    let sum = 0;
    for (let s = 0; s < samples; s++) {
      const x = simulate(b, m0 + Math.floor(rnd() * (m1 - m0)), dir, dist, holdMs);
      sum += x;
      if (x > 0) baseWins++;
      baseCount++;
    }
    real.push(r);
    base.push(sum / samples);
    if (r > 0) realWins++;
  }

  const n = real.length;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const diffs = real.map((r, k) => r - base[k]);
  let ci: [number, number] = [Number.NaN, Number.NaN];
  if (n >= 2) {
    const boots: number[] = [];
    for (let k = 0; k < 2000; k++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += diffs[Math.floor(rnd() * n)];
      boots.push(s / n);
    }
    boots.sort((a, c) => a - c);
    ci = [boots[Math.floor(0.025 * boots.length)], boots[Math.floor(0.975 * boots.length)]];
  }
  const avgR = n ? mean(real) : null;
  const baselineAvgR = n ? mean(base) : null;
  const edgeR = n ? mean(diffs) : null;
  const f = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`;

  const verdict: string[] = [];
  if (!n) verdict.push("No trade could be compared: each needs a stop and must fall inside the price data.");
  else {
    verdict.push(`Your ${n} trades averaged ${f(avgR!)} (R = the trade's own stop distance). Random entries in the same months, with the same side, stop and holding time, averaged ${f(baselineAvgR!)}.`);
    if (n < MIN_TRADES_FOR_VERDICT) verdict.push(`Not enough trades yet for a verdict: ${n} of at least ${MIN_TRADES_FOR_VERDICT}. Keep the stops on and come back.`);
    else if (ci[0] > 0) verdict.push(`Your entries beat random entries by ${f(edgeR!)} per trade (95 % range ${f(ci[0])} to ${f(ci[1])}). That is an edge worth protecting with fixed risk.`);
    else if (ci[1] < 0) verdict.push(`Your entries did worse than random entries by ${f(-edgeR!).replace("+", "")} per trade (95 % range ${f(ci[0])} to ${f(ci[1])}). The timing is costing money; the rules alone would do better.`);
    else verdict.push(`No measurable edge: the difference is ${f(edgeR!)} per trade, and the 95 % range (${f(ci[0])} to ${f(ci[1])}) includes zero.`);
  }
  if (skippedNoStop) verdict.push(`${skippedNoStop} trade${skippedNoStop > 1 ? "s" : ""} had no stop and could not be measured in R.`);
  if (skippedNoData) verdict.push(`${skippedNoData} trade${skippedNoData > 1 ? "s" : ""} fell outside the price data.`);
  return {
    trades: trades.length, used: n, skippedNoStop, skippedNoData, avgR, baselineAvgR, edgeR, ci,
    winRate: n ? realWins / n : null, baselineWinRate: baseCount ? baseWins / baseCount : null, verdict,
  };
}
