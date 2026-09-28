import { describe, it, expect } from "vitest";
import { withDerivedPnl } from "@/lib/journal/derive";
import type { JournalEntry } from "@/lib/types/userData";

const base: JournalEntry = {
  id: "1", timestamp: "2026-09-01T00:00:00Z", symbol: "BTC/USDT", position: "LONG",
  entryPrice: 100, emotion: "Neutral", notes: "", status: "OPEN",
};

describe("withDerivedPnl", () => {
  it("leaves an open trade without exit untouched", () => {
    expect(withDerivedPnl(base)).toEqual(base);
  });
  it("closes the trade and computes net/gross PnL when an exit price arrives", () => {
    const out = withDerivedPnl({ ...base, exitPrice: 110, leverage: 2 });
    expect(out.status).toBe("CLOSED");
    expect(out.grossPnlPercent).toBeCloseTo(20, 10);
    expect(out.pnlPercent).toBeCloseTo(19.8, 10);
    expect(out.pnlSource).toBe("calculated");
  });
  it("never overwrites an exchange-reported PnL", () => {
    const out = withDerivedPnl({ ...base, exitPrice: 110, pnlPercent: 7.5, pnlSource: "exchange" });
    expect(out.pnlPercent).toBe(7.5);
    expect(out.status).toBe("CLOSED");
  });
  it("marks an exchange-reported PnL without exit price as closed", () => {
    expect(withDerivedPnl({ ...base, pnlPercent: -3, pnlSource: "exchange" }).status).toBe("CLOSED");
  });
  it("ignores invalid prices instead of producing Infinity", () => {
    const out = withDerivedPnl({ ...base, entryPrice: 0, exitPrice: 10 });
    expect(out.pnlPercent).toBeUndefined();
  });
});
