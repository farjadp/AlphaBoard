import { describe, it, expect } from "vitest";
import { makeBars, type Bars } from "@/lib/lab/bars";
import { mulberry32 } from "@/lib/lab/robust";
import { edgeCheck, type EdgeTrade } from "@/lib/lab/edge";

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 5);

/** A seeded random walk of one-minute bars over ~6 weeks of weekdays. */
function walk(seed = 1): Bars {
  const r = mulberry32(seed);
  const rows: Array<[number, number, number, number, number]> = [];
  let px = 100;
  for (let d = 0; d < 42; d++) {
    const wd = new Date(T0 + d * 86_400_000).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let m = 0; m < 1440; m++) {
      const o = px;
      px += (r() - 0.5) * 0.2;
      rows.push([T0 + d * 86_400_000 + m * MIN, o, Math.max(o, px) + 0.02, Math.min(o, px) - 0.02, px]);
    }
  }
  return makeBars(rows);
}

/** Trades at random bars; `hindsight` picks the side that the next hour actually went. */
function trades(b: Bars, n: number, hindsight: boolean, seed = 7): EdgeTrade[] {
  const r = mulberry32(seed);
  const out: EdgeTrade[] = [];
  while (out.length < n) {
    const i = Math.floor(r() * (b.t.length - 200));
    const j = i + 60;
    const up = b.c[j] > b.o[i];
    const side = hindsight ? (up ? "LONG" : "SHORT") : r() < 0.5 ? "LONG" : "SHORT";
    const dist = 1.0;
    out.push({ side, entryTime: b.t[i], entryPrice: b.o[i], stop: side === "LONG" ? b.o[i] - dist : b.o[i] + dist, exitTime: b.t[j], exitPrice: b.c[j] });
  }
  return out;
}

describe("edge check (your entries vs random entries)", () => {
  const b = walk();

  it("random trades show no edge: the 95 % interval contains 0", () => {
    const r = edgeCheck(trades(b, 120, false), b, { samples: 60, seed: 3 });
    expect(r.used).toBe(120);
    expect(r.ci[0]).toBeLessThan(0);
    expect(r.ci[1]).toBeGreaterThan(0);
    expect(r.verdict.join(" ")).toMatch(/no measurable edge/i);
  });

  it("hindsight trades show a clear edge: the whole interval is above 0", () => {
    const r = edgeCheck(trades(b, 120, true), b, { samples: 60, seed: 3 });
    expect(r.edgeR).toBeGreaterThan(0.2);
    expect(r.ci[0]).toBeGreaterThan(0);
    expect(r.verdict.join(" ")).toMatch(/beat random entries/i);
  });

  it("says when there are too few trades, and skips trades without a stop or outside the data", () => {
    const t = trades(b, 10, true);
    t.push({ ...t[0], stop: null }, { ...t[0], entryTime: Date.UTC(2020, 0, 1), exitTime: Date.UTC(2020, 0, 2) });
    const r = edgeCheck(t, b, { samples: 20, seed: 1 });
    expect(r).toMatchObject({ used: 10, skippedNoStop: 1, skippedNoData: 1 });
    expect(r.verdict.join(" ")).toMatch(/not enough trades/i);
  });
});
