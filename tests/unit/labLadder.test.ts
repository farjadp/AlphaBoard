import { describe, it, expect } from "vitest";
import { holeAfter, makeBars } from "@/lib/lab/bars";
import { ladderParams, runLadderSet } from "@/lib/lab/ladder";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 19, 12, 0); // Monday
const E = 100;

/** Minute bars from [low, high] pairs; open = first bar's entry price. */
function path(ranges: Array<[number, number]>, gapAfter?: number) {
  const rows = ranges.map(([lo, hi], i) => {
    const t = T0 + i * MIN + (gapAfter != null && i > gapAfter ? 6 * 3_600_000 : 0);
    return [t, i === 0 ? E : lo, hi, lo, (lo + hi) / 2] as const;
  });
  const b = makeBars(rows);
  return { b, holes: holeAfter(b) };
}

const p = ladderParams(1, 0); // unit 1, no cost: P2 −1, stop −1.625, A +1.25, TP after return +0.625, buf 0.0375
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe("lab ladder set (GoldHedgeManager)", () => {
  it("scenario A: target first → 75 % closed, the rest out at breakeven + buffer", () => {
    const { b, holes } = path([[100, 100], [100, 101.3], [100.05, 101], [99.5, 100.5], [99, 99.5]]);
    const r = runLadderSet(b, holes, 0, 1, p)!;
    expect(r.kind).toBe("A");
    close(r.pnl, 0.75 * 1.25 + 0.25 * 0.0375);
    expect(r.exit).toBe(3);
    expect(r.returned).toBeNull();
  });

  it("scenario B: P2 fills, price returns, P2 then reaches its target", () => {
    const { b, holes } = path([[100, 100], [98.9, 99.5], [99.2, 100.05], [99.1, 99.8], [99.5, 100.7]]);
    const r = runLadderSet(b, holes, 0, 1, p)!;
    expect(r.kind).toBe("B_BACK_TP");
    close(r.pnl, 0.0375 + 1 + 0.625);
    expect(r.returned).toBe(true);
    close(r.worst, 1.625 + 0.625);
  });

  it("scenario B: P2 fills and both stops are hit", () => {
    const { b, holes } = path([[100, 100], [98.95, 99.5], [98.3, 99]]);
    const r = runLadderSet(b, holes, 0, 1, p)!;
    expect(r.kind).toBe("B_LOSS");
    close(r.pnl, -1.625 - 0.625);
    expect(r.returned).toBe(false);
  });

  it("a bar that touches the stop and the return resolves as the stop", () => {
    const { b, holes } = path([[100, 100], [98.95, 99.5], [98.3, 100.1]]);
    expect(runLadderSet(b, holes, 0, 1, p)!.kind).toBe("B_LOSS");
  });

  it("after the return, a dip to P2 + buffer closes P2 at breakeven", () => {
    const { b, holes } = path([[100, 100], [98.95, 99.5], [99.5, 100.05], [99.02, 99.6]]);
    const r = runLadderSet(b, holes, 0, 1, p)!;
    expect(r.kind).toBe("B_BACK_BE");
    close(r.pnl, 0.0375 * 2);
  });

  it("without P2 the first position just stops out", () => {
    const { b, holes } = path([[100, 100], [99, 99.5], [98.3, 99]]);
    const r = runLadderSet(b, holes, 0, 1, ladderParams(1, 0, { p2: null }))!;
    expect(r.kind).toBe("STOP");
    close(r.pnl, -1.625);
    close(r.worst, 1.625);
  });

  it("shorts mirror longs", () => {
    const { b, holes } = path([[100, 100], [98.6, 99.9], [98.9, 99.97], [99.4, 100.5], [100, 101]]);
    const r = runLadderSet(b, holes, 0, -1, p)!;
    expect(r.kind).toBe("A");
    close(r.pnl, 0.75 * 1.25 + 0.25 * 0.0375);
  });

  it("charges the cost per position and tracks the worst open P&L", () => {
    const { b, holes } = path([[100, 100], [98.95, 99.5], [98.3, 99]]);
    const r = runLadderSet(b, holes, 0, 1, ladderParams(1, 0.1))!;
    close(r.pnl, -1.625 - 0.625 - 0.2);
    expect(r.mae).toBeLessThanOrEqual(r.pnl + 1e-9);
  });

  it("drops a set that is still open when a data hole comes", () => {
    const { b, holes } = path([[100, 100], [99.5, 100.5], [99.6, 100.4], [99.7, 100.3]], 1);
    expect(runLadderSet(b, holes, 0, 1, p)).toBeNull();
  });
});
