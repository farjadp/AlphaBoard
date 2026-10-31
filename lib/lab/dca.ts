/**
 * Strategy Lab — multi-symbol DCA ladder ("Robi" family) on hourly bars (pure).
 *
 * Long only. Each hour, symbols whose close is ≥ `drop` under their 24-hour high are bought at the next
 * open (biggest drop first) while slots are free and BTC is not falling hard. A position adds at −d1 and
 * −d2 from its first price (sizes from `sizes`); only `deepSlots` of the slots may reach the second add.
 * It closes at +tp0 over the average (+tp1 after an add), or at an optional stop. Every slot reserves its
 * whole ladder budget up front, so exposure never exceeds the wallet (no liquidation). A symbol whose
 * data ends (delisted) is sold at its last price. Equity is marked to market every hour, which is what
 * shows the drawdown a realized-only curve hides.
 */
import { maxDrawdownPct, perYearPct } from "./metrics";

/** A price column; Float32 halves the memory of a large basket (7 significant digits is plenty here). */
type Col = Float64Array | Float32Array;

export interface Cube {
  /** Hour timestamps (ms), shared by every symbol. */
  t: Float64Array;
  syms: string[];
  /** Per symbol; NaN where the symbol has no bar. */
  o: Col[];
  h: Col[];
  l: Col[];
  c: Col[];
}

export interface DcaParams {
  slots: number;
  deepSlots: number;
  drop: number;
  d1: number;
  d2: number;
  sizes: [number, number, number];
  tp0: number;
  tp1: number;
  /** Fee per fill as a fraction of notional. */
  fee: number;
  /** No entries while BTC is down more than this over 24 h; null = off. */
  btcLock: number | null;
  /** Index of BTC in `syms` (for the lock); −1 = none. */
  btcIndex: number;
  /** Optional stop as a fraction under the average; null = no stop (the original). */
  stopLoss: number | null;
}

export interface DcaRun {
  finalBalance: number;
  monthlyPct: number;
  maxDdMtmPct: number;
  maxDdRealizedPct: number;
  perYear: Record<string, number>;
  episodes: number;
  /** Share of closed episodes that ended at depth 0 / 1 / 2. */
  depthShare: [number, number, number];
  avgSlots: number;
  /** Daily samples [time ms, equity]: marked to market, and realized only (open positions at cost). */
  curves: { mtm: Array<[number, number]>; realized: Array<[number, number]> };
}

interface Pos { e0: number; avg: number; qty: number; cost: number; unit: number; depth: number; maxd: number; budget: number; mark: number }

export function runDca(cube: Cube, p: DcaParams, startMs: number, start = 1000): DcaRun {
  const n = cube.t.length;
  const m = cube.syms.length;
  const lastValid = new Int32Array(m).fill(-1);
  for (let j = 0; j < m; j++) for (let k = n - 1; k >= 0; k--) if (!Number.isNaN(cube.c[j][k])) { lastValid[j] = k; break; }
  const hi24 = cube.h.map((h) => {
    const out = new Float64Array(n).fill(Number.NaN);
    for (let k = 23; k < n; k++) {
      let mx = -Infinity;
      for (let q = k - 23; q <= k; q++) if (h[q] > mx) mx = h[q];
      if (mx > -Infinity) out[k] = mx;
    }
    return out;
  });
  const deepMult = p.sizes[0] + p.sizes[1] + p.sizes[2];
  const shallowMult = p.sizes[0] + p.sizes[1];

  let cash = start;
  const pos = new Map<number, Pos>();
  const mtm: number[] = [];
  const real: number[] = [];
  const curve: Array<[number, number]> = [];
  const daily: Array<[number, number]> = [];
  const dailyReal: Array<[number, number]> = [];
  const depths = [0, 0, 0];
  let slotSum = 0;
  let steps = 0;
  let s0 = 0;
  while (s0 < n && cube.t[s0] < startMs) s0++;
  if (s0 < 1) s0 = 1;

  const close = (j: number, x: Pos, px: number) => {
    cash += x.qty * px * (1 - p.fee);
    depths[x.depth]++;
    pos.delete(j);
  };

  for (let k = s0; k < n - 1; k++) {
    // 1) manage open positions with bar k
    for (const [j, x] of [...pos]) {
      if (k > lastValid[j]) { close(j, x, cube.c[j][lastValid[j]]); continue; }
      const H = cube.h[j][k];
      const L = cube.l[j][k];
      if (Number.isNaN(H)) continue; // no bar this hour: keep the last known mark
      x.mark = cube.c[j][k];
      const tp = x.avg * (1 + (x.depth === 0 ? p.tp0 : p.tp1));
      if (H >= tp) { close(j, x, tp); continue; }
      if (p.stopLoss != null && L <= x.avg * (1 - p.stopLoss)) { close(j, x, Math.min(x.avg * (1 - p.stopLoss), cube.o[j][k])); continue; }
      const levels = [x.e0 * (1 - p.d1), x.e0 * (1 - p.d2)];
      for (let dd = 1; dd <= 2; dd++) {
        if (x.depth === dd - 1 && dd <= x.maxd && L <= levels[dd - 1]) {
          const px = Math.min(levels[dd - 1], cube.o[j][k]);
          const notional = x.unit * p.sizes[dd];
          const q = notional / px;
          cash -= notional * (1 + p.fee);
          x.cost += notional * (1 + p.fee);
          x.avg = (x.avg * x.qty + px * q) / (x.qty + q);
          x.qty += q;
          x.depth = dd;
        }
      }
    }
    // 2) entries at the next open
    const b = p.btcIndex;
    const btcChg = b >= 0 && k >= 24 && cube.c[b][k - 24] > 0 ? cube.c[b][k] / cube.c[b][k - 24] - 1 : 0;
    const free = p.slots - pos.size;
    if (free > 0 && (p.btcLock == null || btcChg > -p.btcLock)) {
      const cand: Array<[number, number]> = [];
      for (let j = 0; j < m; j++) {
        if (pos.has(j) || k + 1 > lastValid[j] - 1) continue; // not in its last bars (about to be delisted)
        const dropNow = 1 - cube.c[j][k] / hi24[j][k];
        if (dropNow >= p.drop && !Number.isNaN(cube.o[j][k + 1])) cand.push([j, dropNow]);
      }
      cand.sort((a, c) => c[1] - a[1]);
      let reserved = 0;
      let deepUsed = 0;
      for (const x of pos.values()) { reserved += x.budget - x.cost; if (x.maxd === 2) deepUsed++; }
      for (const [j] of cand.slice(0, free)) {
        const freeCash = cash - reserved;
        if (freeCash <= 1) break;
        const budget = freeCash / (p.slots - pos.size);
        const deep = deepUsed < p.deepSlots;
        const unit = budget / (deep ? deepMult : shallowMult);
        const px = cube.o[j][k + 1];
        cash -= unit * (1 + p.fee);
        const x: Pos = { e0: px, avg: px, qty: unit / px, cost: unit * (1 + p.fee), unit, depth: 0, maxd: deep ? 2 : 1, budget, mark: px };
        pos.set(j, x);
        reserved += budget - x.cost;
        if (deep) deepUsed++;
      }
    }
    // 3) equity, marked to market
    let val = 0;
    let cost = 0;
    for (const x of pos.values()) {
      val += x.qty * x.mark;
      cost += x.cost;
    }
    mtm.push(cash + val);
    real.push(cash + cost);
    curve.push([cube.t[k], cash + val]);
    if (steps % 24 === 0) { daily.push([cube.t[k], cash + val]); dailyReal.push([cube.t[k], cash + cost]); }
    slotSum += pos.size;
    steps++;
  }
  const final = mtm.length ? mtm[mtm.length - 1] : start;
  const months = steps / (24 * 30.44);
  const closed = depths[0] + depths[1] + depths[2];
  return {
    finalBalance: final,
    monthlyPct: months > 0 ? (Math.pow(final / start, 1 / months) - 1) * 100 : 0,
    maxDdMtmPct: maxDrawdownPct(mtm),
    maxDdRealizedPct: maxDrawdownPct(real),
    perYear: perYearPct(curve, start),
    episodes: closed,
    depthShare: closed ? [depths[0] / closed, depths[1] / closed, depths[2] / closed] : [0, 0, 0],
    avgSlots: steps ? slotSum / steps : 0,
    curves: { mtm: daily, realized: dailyReal },
  };
}
