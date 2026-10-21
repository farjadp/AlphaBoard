import { describe, it, expect } from "vitest";
import { DcaStudySchema, runDcaStudy } from "@/lib/lab/dcaStudy";
import type { Cube } from "@/lib/lab/dca";

const H = 3_600_000;
const T0 = Date.UTC(2021, 0, 1);

/** Two coins and BTC over 120 days: A grinds down 60 % and never recovers, B saw-tooths. */
function cube(): Cube {
  const n = 120 * 24;
  const mk = (f: (k: number) => number) => {
    const c = Float32Array.from({ length: n }, (_, k) => f(k));
    const o = Float32Array.from(c, (_, k) => (k ? c[k - 1] : c[0]));
    const h = Float32Array.from(c, (x, k) => Math.max(x, o[k]) * 1.002);
    const l = Float32Array.from(c, (x, k) => Math.min(x, o[k]) * 0.998);
    return { o, h, l, c };
  };
  const a = mk((k) => 100 * (1 - 0.6 * k / n));
  const b = mk((k) => 100 * (1 + 0.06 * Math.sin(k / 9)));
  const btc = mk(() => 30_000);
  return { t: Float64Array.from({ length: n }, (_, k) => T0 + k * H), syms: ["AUSDT", "BUSDT", "BTCUSDT"], o: [a.o, b.o, btc.o], h: [a.h, b.h, btc.h], l: [a.l, b.l, btc.l], c: [a.c, b.c, btc.c] };
}

describe("DCA study", () => {
  it("defaults are the Robi settings", () => {
    expect(DcaStudySchema.parse({ kind: "dca", basketId: "b" })).toMatchObject({
      start: "2021-01-01", slots: 15, deepSlots: 10, dropPct: 3, d1Pct: 9, d2Pct: 19.5, sizes: [1, 1.8, 4.7], tp0Pct: 1.5, tp1Pct: 1, feePct: 0.05, btcLockPct: 5, stopLossPct: null,
    });
  });

  it("reports both drawdowns, by-year returns, both curves and a plain verdict", () => {
    const r = runDcaStudy(cube(), DcaStudySchema.parse({ kind: "dca", basketId: "b", slots: 2, deepSlots: 2 }));
    expect(r.episodes).toBeGreaterThan(0);
    expect(r.maxDdMtmPct).toBeGreaterThan(r.maxDdRealizedPct);
    expect(r.curves.mtm.length).toBeGreaterThan(50);
    expect(r.curves.realized.length).toBe(r.curves.mtm.length);
    const text = r.verdict.join(" ");
    expect(text).toMatch(/\$1,000 became/);
    expect(text).toMatch(/open positions/);
    expect(text).toMatch(/past data/);
  });

  it("a stop changes the outcome and says so", () => {
    const r = runDcaStudy(cube(), DcaStudySchema.parse({ kind: "dca", basketId: "b", slots: 2, deepSlots: 2, stopLossPct: 15 }));
    expect(r.verdict.join(" ")).toMatch(/stop/);
  });
});
