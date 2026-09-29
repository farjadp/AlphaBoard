import { describe, it, expect } from "vitest";
import { marketSessions, sessionHeadline } from "@/lib/market/sessions";

// Toronto (UTC-4 in late September): local day 2026-09-28 starts at 04:00 UTC.
const DAY_START = new Date("2026-09-28T04:00:00Z");

describe("marketSessions", () => {
  it("places London and New York on the viewer's day and marks both open at 10:00 Toronto", () => {
    const now = new Date("2026-09-28T14:00:00Z"); // Mon 10:00 Toronto, 15:00 London
    const s = marketSessions(now, DAY_START);
    const ny = s.find((x) => x.key === "newyork")!;
    const ldn = s.find((x) => x.key === "london")!;
    expect(ny.isOpen).toBe(true);
    expect(ldn.isOpen).toBe(true);
    // NY 09:30–16:00 Toronto time → 9.5/24 .. 16/24 of the local day
    expect(ny.segments[0].start).toBeCloseTo(9.5 / 24, 4);
    expect(ny.segments[0].end).toBeCloseTo(16 / 24, 4);
    // London 08:00–16:30 BST = 03:00–11:30 Toronto
    expect(ldn.segments[0].start).toBeCloseTo(3 / 24, 4);
    expect(ldn.segments[0].end).toBeCloseTo(11.5 / 24, 4);
    expect(ny.status).toBe("closes in 6h");
  });

  it("splits a session that crosses the viewer's midnight into two segments", () => {
    const now = new Date("2026-09-28T14:00:00Z");
    const tokyo = marketSessions(now, DAY_START).find((x) => x.key === "tokyo")!;
    // Tokyo 09:00–15:30 JST = 20:00–02:30 Toronto: 00:00–02:30 (Monday's session) and 20:00–24:00 (Tuesday's)
    expect(tokyo.segments.length).toBe(2);
    expect(tokyo.segments[0].start).toBeCloseTo(0, 4);
    expect(tokyo.segments[0].end).toBeCloseTo(2.5 / 24, 4);
    expect(tokyo.segments[1].start).toBeCloseTo(20 / 24, 4);
    expect(tokyo.segments[1].end).toBeCloseTo(1, 4);
    expect(tokyo.isOpen).toBe(false);
    expect(tokyo.status).toBe("opens in 10h");
  });

  it("skips weekends in the market's own time zone", () => {
    const satStart = new Date("2026-09-26T04:00:00Z");
    const now = new Date("2026-09-26T14:00:00Z"); // Saturday
    const ny = marketSessions(now, satStart).find((x) => x.key === "newyork")!;
    expect(ny.isOpen).toBe(false);
    expect(ny.segments.length).toBe(0);
    expect(ny.status).toBe("opens Mon 09:30");
  });
});

describe("sessionHeadline", () => {
  it("names the open markets and the soonest close", () => {
    const now = new Date("2026-09-28T14:00:00Z");
    expect(sessionHeadline(marketSessions(now, DAY_START))).toBe("London & New York open · London closes in 1h 30m");
  });

  it("names the next opening when everything is closed", () => {
    const now = new Date("2026-09-28T22:00:00Z"); // 18:00 Toronto, all four closed; Sydney and Tokyo both open at 20:00, list order wins
    expect(sessionHeadline(marketSessions(now, DAY_START))).toBe("Stock markets closed · Sydney opens in 2h");
  });
});
