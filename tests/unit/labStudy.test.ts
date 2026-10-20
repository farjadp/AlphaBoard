import { describe, it, expect } from "vitest";
import { makeBars } from "@/lib/lab/bars";
import { LadderStudySchema, runLadderStudy } from "@/lib/lab/study";

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 5, 0, 0); // Monday

/** A deterministic zig-zag: ±1.4 around 100 with a 40-minute period, Monday–Friday, 3 weeks of minutes. */
function zigzag() {
  const rows: Array<[number, number, number, number, number]> = [];
  for (let d = 0; d < 21; d++) {
    const day = new Date(T0 + d * 86_400_000).getUTCDay();
    if (day === 0 || day === 6) continue;
    for (let m = 0; m < 1440; m++) {
      const t = T0 + d * 86_400_000 + m * MIN;
      const ph = (m % 40) / 40;
      const px = 100 + 1.4 * (ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4);
      rows.push([t, px, px + 0.05, px - 0.05, px]);
    }
  }
  return makeBars(rows);
}

const spec = (o: Record<string, unknown> = {}) => LadderStudySchema.parse({ kind: "ladder", datasetId: "d1", ...o });

describe("lab study (ladder)", () => {
  const bars = zigzag();

  it("applies defaults from the research", () => {
    const s = spec();
    expect(s).toMatchObject({ secondPosition: false, direction: "trend", entryEveryMin: 15, hoursUtc: [1, 21], holes: "keep", robustness: 30 });
    expect(s.money).toMatchObject({ riskPct: 0.5, slots: 1, dailyLossPct: 2, maxConsecLosses: 2, cooldownMin: 30, martingale: false });
  });

  it("reports sets, the account, robustness and a plain verdict", () => {
    const r = runLadderStudy(bars, null, spec({ direction: "both", secondPosition: true, robustness: 5 }));
    expect(r.unit).toBeGreaterThan(0);
    expect(r.sets.count).toBeGreaterThan(100);
    expect(r.sets.returnToEntry).not.toBeNull();
    expect(r.sets.coinFlip).toBeCloseTo(0.625 / 1.625, 9);
    expect(r.account.full.trades).toBeGreaterThan(0);
    expect(r.account.robust!.runs).toBe(5);
    expect(r.account.full.curve.length).toBeLessThanOrEqual(301);
    expect(r.verdict.length).toBeGreaterThanOrEqual(3);
    expect(r.verdict.join(" ")).toMatch(/coin flip/);
    expect(r.verdict.join(" ")).toMatch(/past data/);
  });

  it("uses the dataset's median spread plus the commission as the cost", () => {
    const spread = new Float64Array(bars.t.length).fill(0.3);
    const r = runLadderStudy(bars, spread, spec({ commission: 0.1, robustness: 0 }));
    expect(r.cost).toBeCloseTo(0.4, 12);
    expect(r.account.robust).toBeNull();
  });

  it("refuses a series too short to measure a candle", () => {
    expect(() => runLadderStudy(makeBars([[T0, 1, 1, 1, 1]]), null, spec())).toThrow(/too short/);
  });

  it("flags martingale as the warning case", () => {
    const r = runLadderStudy(bars, null, spec({ direction: "both", robustness: 0, money: { martingale: true } }));
    expect(r.verdict.join(" ")).toMatch(/martingale/i);
  });
});
