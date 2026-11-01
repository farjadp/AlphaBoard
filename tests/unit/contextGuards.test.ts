import { describe, it, expect } from "vitest";
import { formatUsage, type SessionUsage } from "@/lib/sessions/desk/context";

const base: SessionUsage = {
  equity: 1_000, freeCapital: 1_000, lossUsed: 0, lossLimit: 100, tradesUsed: 1, maxTrades: 6,
  openPositions: 0, maxOpenPositions: 2, timeLeftMin: 60, llmCostUsd: 0.1, maxLlmCostUsd: 1,
};

describe("formatUsage — money-management guards (P11a)", () => {
  it("adds nothing for callers that do not pass the guard facts", () => {
    expect(formatUsage(base)).not.toMatch(/losing trades/i);
  });
  it("shows the streak and says entries are open while under the limit", () => {
    const t = formatUsage({ ...base, lossStreak: 1, maxConsecLosses: 2, lossCooldownLeftMin: 0 });
    expect(t).toMatch(/Losing trades in a row today 1 \(limit 2\)/);
    expect(t).not.toMatch(/NEW ENTRIES ARE CLOSED/);
  });
  it("tells the strategist entries are closed at the limit or during the cooldown", () => {
    expect(formatUsage({ ...base, lossStreak: 2, maxConsecLosses: 2, lossCooldownLeftMin: 0 })).toMatch(/NEW ENTRIES ARE CLOSED/);
    const t = formatUsage({ ...base, lossStreak: 1, maxConsecLosses: 2, lossCooldownLeftMin: 12 });
    expect(t).toMatch(/after-loss cooldown 12 min left/);
    expect(t).toMatch(/NEW ENTRIES ARE CLOSED/);
  });
});
