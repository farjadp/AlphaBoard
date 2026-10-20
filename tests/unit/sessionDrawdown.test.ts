import { describe, it, expect } from "vitest";
import { nextDrawdown } from "@/lib/sessions/drawdown";

describe("nextDrawdown (mark-to-market)", () => {
  it("tracks the peak and the deepest fall from it", () => {
    let s: { peak: number | null; maxDd: number } = { peak: null, maxDd: 0 };
    for (const e of [100, 104, 97, 101, 110, 103]) s = nextDrawdown(s, e);
    expect(s).toMatchObject({ peak: 110, maxDd: 7 });
  });

  it("reports changed only when the peak or the max drawdown moved", () => {
    expect(nextDrawdown({ peak: 100, maxDd: 3 }, 99).changed).toBe(false);
    expect(nextDrawdown({ peak: 100, maxDd: 3 }, 95).changed).toBe(true);
    expect(nextDrawdown({ peak: 100, maxDd: 3 }, 101).changed).toBe(true);
  });

  it("starts the peak at the first sample", () => {
    expect(nextDrawdown({ peak: null, maxDd: 0 }, 80)).toEqual({ peak: 80, maxDd: 0, changed: true });
  });
});
