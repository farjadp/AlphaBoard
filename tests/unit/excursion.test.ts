import { describe, expect, it } from "vitest";
import { excursionR, nextExtremes } from "@/lib/sessions/excursion";

describe("MFE / MAE", () => {
  it("tracks the best and worst price, and asks for a write only when one moves", () => {
    const p = { side: "SHORT" as const, entryPrice: 156.845, bestPrice: null, worstPrice: null };
    expect(nextExtremes(p, 156.9)).toEqual({ bestPrice: 156.845, worstPrice: 156.9 });
    const q = { ...p, bestPrice: 156.7, worstPrice: 156.9 };
    expect(nextExtremes(q, 156.8)).toBeNull();
    expect(nextExtremes(q, 156.6)).toEqual({ bestPrice: 156.6, worstPrice: 156.9 });
  });

  it("expresses them in R of the initial stop, counting the exit price", () => {
    // 9/30 USD/JPY short: entry 156.845, initial stop 157.18 (R = 0.335), never went for it, stopped at 157.12.
    const x = excursionR({ side: "SHORT", entryPrice: 156.845, initialStop: 157.18, bestPrice: 156.845, worstPrice: 157.1, closePrice: 157.12 });
    expect(x!.mfeR).toBe(0);
    expect(x!.maeR).toBeCloseTo(0.821, 3);
    expect(excursionR({ side: "LONG", entryPrice: 1, initialStop: null, bestPrice: 2, worstPrice: 0.5 })).toBeNull();
  });
});
