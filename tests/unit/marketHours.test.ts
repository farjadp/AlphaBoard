import { describe, expect, it } from "vitest";
import { minutesToWeeklyClose, tradesWeekdaysOnly, weekendClosed } from "@/lib/market/hours";

const at = (iso: string) => new Date(iso);

describe("market hours (FX, metals, indices: Sunday 17:00 → Friday 17:00 New York)", () => {
  it("knows which symbols keep weekday hours", () => {
    expect(tradesWeekdaysOnly("EUR/USD")).toBe(true);
    expect(tradesWeekdaysOnly("XAU/USD")).toBe(true);
    expect(tradesWeekdaysOnly("BTC/USDT")).toBe(false);
    expect(tradesWeekdaysOnly("NOT/ASSET")).toBe(false);
  });

  it("counts down to the Friday close in summer time (EDT, close = 21:00 UTC)", () => {
    // Fri 2026-10-02 18:08 UTC = 14:08 New York → 172 min to 17:00.
    expect(minutesToWeeklyClose(at("2026-10-02T18:08:00Z"))).toBe(172);
    // Thu 2026-10-01 21:00 UTC → one full day + 0 min.
    expect(minutesToWeeklyClose(at("2026-10-01T21:00:00Z"))).toBe(1440);
  });

  it("uses the winter close (EST, close = 22:00 UTC)", () => {
    // Fri 2026-12-04 21:30 UTC = 16:30 New York → 30 min left.
    expect(minutesToWeeklyClose(at("2026-12-04T21:30:00Z"))).toBe(30);
  });

  it("is closed from Friday 17:00 to Sunday 17:00 New York", () => {
    expect(weekendClosed(at("2026-10-02T21:00:00Z"))).toBe(true); // Fri 17:00 NY
    expect(weekendClosed(at("2026-10-03T12:00:00Z"))).toBe(true); // Saturday
    expect(weekendClosed(at("2026-10-04T20:59:00Z"))).toBe(true); // Sun 16:59 NY
    expect(weekendClosed(at("2026-10-04T21:00:00Z"))).toBe(false); // Sun 17:00 NY — open
    expect(weekendClosed(at("2026-10-02T20:59:00Z"))).toBe(false);
    expect(minutesToWeeklyClose(at("2026-10-03T12:00:00Z"))).toBe(0);
  });

  it("counts the whole week from the Sunday open", () => {
    expect(minutesToWeeklyClose(at("2026-10-04T21:00:00Z"))).toBe(5 * 1440);
  });
});
