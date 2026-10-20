import { describe, it, expect } from "vitest";
import { lossStreak } from "@/lib/risk/streak";

const DAY = Date.UTC(2026, 9, 20);
const at = (h: number, m = 0) => DAY + h * 3_600_000 + m * 60_000;

describe("lossStreak", () => {
  it("counts trailing losses of the UTC day, a win resets", () => {
    const r = lossStreak([{ closedAt: at(9), pnl: -5 }, { closedAt: at(10), pnl: 3 }, { closedAt: at(11), pnl: -2 }, { closedAt: at(12), pnl: -1 }], at(13));
    expect(r).toEqual({ streak: 2, lastLossAt: at(12) });
  });

  it("ignores the order of the input", () => {
    expect(lossStreak([{ closedAt: at(12), pnl: -1 }, { closedAt: at(11), pnl: -2 }, { closedAt: at(10), pnl: 3 }], at(13)).streak).toBe(2);
  });

  it("resets the streak at UTC midnight but keeps lastLossAt for cooldowns", () => {
    const r = lossStreak([{ closedAt: DAY - 60_000, pnl: -4 }, { closedAt: DAY - 30_000, pnl: -4 }], at(0, 5));
    expect(r).toEqual({ streak: 0, lastLossAt: DAY - 30_000 });
  });

  it("does not count a breakeven close as a loss", () => {
    expect(lossStreak([{ closedAt: at(9), pnl: -1 }, { closedAt: at(10), pnl: 0 }], at(11)).streak).toBe(0);
  });

  it("returns 0 / null without closes", () => {
    expect(lossStreak([], at(1))).toEqual({ streak: 0, lastLossAt: null });
  });
});
