/**
 * Strategy Lab — one GoldHedgeManager set on 1-minute bars (pure).
 *
 * P1 enters at the bar's open. Optional P2 (same size) waits `p2` against it. Scenario A: price reaches
 * `ta` in favour first → close `closePct` of P1, the rest is stopped at entry + `buf`. Scenario B: P2 fills
 * → both stop at `sl1` from P1's entry; if price comes back to P1's entry (+`buf`) P1 closes there, P2's
 * stop moves to its own entry + `buf` and its target is P1's entry + `tb`. Without P2, P1 simply has its
 * stop at `sl1`. Inside one bar, a stop beats a target. All amounts are price units for one unit of size.
 */
import type { Bars } from "./bars";

export interface LadderParams {
  /** P2 distance from P1's entry; null = no second position. */
  p2: number | null;
  /** P2's own risk (its stop distance from P2's entry): used only for the default sl1. */
  s2: number;
  /** Stop of both positions, measured from P1's entry. */
  sl1: number;
  /** Scenario A target from P1's entry. */
  ta: number;
  /** P2's target beyond P1's entry after the return. */
  tb: number;
  /** Breakeven buffer. */
  buf: number;
  /** Share of P1 closed at scenario A. */
  closePct: number;
  /** Round-trip cost per position (spread + commission), price units. */
  cost: number;
  /** A set still open after this many bars is closed at the last close (bars, so a closed market does not use it up). */
  maxHoldBars: number;
  /** Optional wall-clock limit as well (ms); the earlier of the two applies. */
  maxHoldMs?: number;
}

export type SetKind = "A" | "B_LOSS" | "B_BACK_TP" | "B_BACK_BE" | "STOP" | "OPEN";

export interface SetResult {
  kind: SetKind;
  /** Result for one unit of size, costs included. */
  pnl: number;
  /** Bar index of the exit. */
  exit: number;
  /** Worst case of the set if every stop is hit (sizing denominator). */
  worst: number;
  /** Most negative open P&L seen while the set was open (costs included). */
  mae: number;
  /** After P2 filled: did price come back to P1's entry before the stop? null when P2 never filled. */
  returned: boolean | null;
}

/** Distances as multiples of the candle `unit` (defaults = the EA's candle mode: gold ≈ $8 / $5 / $13 / $10 / $5 / $0.30). */
export function ladderParams(
  unit: number,
  cost: number,
  o: Partial<{ p2: number | null; s2: number; sl1: number; ta: number; tb: number; buf: number; closePct: number; maxHoldBars: number; maxHoldMs: number }> = {},
): LadderParams {
  const p2 = o.p2 === undefined ? 1 : o.p2;
  const s2 = o.s2 ?? 0.625;
  return {
    p2: p2 == null ? null : p2 * unit,
    s2: s2 * unit,
    sl1: (o.sl1 ?? (p2 == null ? 1.625 : p2 + s2)) * unit,
    ta: (o.ta ?? 1.25) * unit,
    tb: (o.tb ?? 0.625) * unit,
    buf: (o.buf ?? 0.0375) * unit,
    closePct: o.closePct ?? 0.75,
    cost,
    maxHoldBars: o.maxHoldBars ?? 3 * 1440,
    maxHoldMs: o.maxHoldMs,
  };
}

/** Simulate one set from bar i0 in direction dir; null when a data hole comes before it resolves. */
export function runLadderSet(b: Bars, holes: Int32Array, i0: number, dir: 1 | -1, p: LadderParams): SetResult | null {
  const n = b.t.length;
  const d = dir;
  const E = b.o[i0];
  const fav = (i: number) => (d > 0 ? b.h[i] : b.l[i]);
  const adv = (i: number) => (d > 0 ? b.l[i] : b.h[i]);
  const reached = (px: number, level: number) => (px - level) * d >= 0; // favourable side
  const breached = (px: number, level: number) => (px - level) * d <= 0; // adverse side

  // end = first bar past the holding limit or past the next hole; reaching it unresolved after a hole → drop.
  let end = Math.min(n, i0 + p.maxHoldBars);
  if (p.maxHoldMs != null) {
    const limitT = b.t[i0] + p.maxHoldMs;
    let j = i0;
    while (j < end && b.t[j] < limitT) j++;
    end = j;
  }
  const holeEnd = holes[i0] + 1;
  const hole = holeEnd <= end;
  if (hole) end = holeEnd;
  const last = end - 1;
  const worst = p.sl1 + (p.p2 == null ? 0 : p.sl1 - p.p2);
  let mae = 0;
  const seeP1 = (i: number, floor: number) => {
    const px = breached(adv(i), floor) ? floor : adv(i);
    mae = Math.min(mae, (px - E) * d - p.cost);
  };

  const sl = E - d * p.sl1;
  const firstAdverse = p.p2 == null ? sl : E - d * p.p2;
  let i = i0;
  for (; i < end; i++) {
    seeP1(i, firstAdverse);
    if (breached(adv(i), firstAdverse)) break;
    if (reached(fav(i), E + d * p.ta)) {
      // Scenario A: part closed at the target, the rest has its stop at entry + buffer.
      const be = E + d * p.buf;
      for (let j = i + 1; j < end; j++) {
        if (breached(adv(j), be)) return { kind: "A", pnl: p.closePct * p.ta + (1 - p.closePct) * p.buf - p.cost, exit: j, worst, mae, returned: null };
      }
      if (hole) return null;
      return { kind: "A", pnl: p.closePct * p.ta + (1 - p.closePct) * (b.c[last] - E) * d - p.cost, exit: last, worst, mae, returned: null };
    }
  }
  if (i >= end) {
    if (hole) return null;
    return { kind: "OPEN", pnl: (b.c[last] - E) * d - p.cost, exit: last, worst, mae, returned: null };
  }
  if (p.p2 == null) return { kind: "STOP", pnl: -p.sl1 - p.cost, exit: i, worst, mae: Math.min(mae, -p.sl1 - p.cost), returned: null };

  // Scenario B: P2 filled in bar i.
  const P2 = E - d * p.p2;
  const lossB = -p.sl1 - (p.sl1 - p.p2) - 2 * p.cost;
  const seeBoth = (k: number) => {
    const px = breached(adv(k), sl) ? sl : adv(k);
    mae = Math.min(mae, (px - E) * d + (px - P2) * d - 2 * p.cost);
  };
  seeBoth(i);
  if (breached(adv(i), sl)) return { kind: "B_LOSS", pnl: lossB, exit: i, worst, mae: Math.min(mae, lossB), returned: false };
  let k = i + 1;
  for (; k < end; k++) {
    seeBoth(k);
    if (breached(adv(k), sl)) return { kind: "B_LOSS", pnl: lossB, exit: k, worst, mae: Math.min(mae, lossB), returned: false };
    if (reached(fav(k), E + d * p.buf)) break;
  }
  if (k >= end) {
    if (hole) return null;
    return { kind: "OPEN", pnl: (b.c[last] - E) * d + (b.c[last] - P2) * d - 2 * p.cost, exit: last, worst, mae, returned: null };
  }
  // P1 closed at entry + buffer; P2 now has its stop at its own entry + buffer and a target at E + tb.
  const be2 = P2 + d * p.buf;
  const tp2 = E + d * p.tb;
  // From the next bar: inside the return bar price was rising from P2 to P1's entry.
  for (let j = k + 1; j < end; j++) {
    if (breached(adv(j), be2)) return { kind: "B_BACK_BE", pnl: 2 * p.buf - 2 * p.cost, exit: j, worst, mae, returned: true };
    if (reached(fav(j), tp2)) return { kind: "B_BACK_TP", pnl: p.buf + p.p2 + p.tb - 2 * p.cost, exit: j, worst, mae, returned: true };
  }
  if (hole) return null;
  return { kind: "OPEN", pnl: p.buf + (b.c[last] - P2) * d - 2 * p.cost, exit: last, worst, mae, returned: true };
}
