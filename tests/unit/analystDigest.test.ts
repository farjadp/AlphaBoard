import { describe, expect, it } from "vitest";
import { digestDue, digestPost, type DigestZone } from "@/lib/analyst/digest";

const z = (o: Partial<DigestZone>): DigestZone => ({
  symbol: "XAU/USD", kind: "BUY", low: 0, high: 0, direction: null, closeTf: null, state: "WAITING", signalState: null, triggerPrice: null, tpHit: 0, ...o,
});
const MON = new Date("2026-11-16T05:30:00Z");

describe("digestDue", () => {
  it("is weekdays inside the morning window only", () => {
    expect(digestDue(MON)).toBe(true);
    expect(digestDue(new Date("2026-11-16T04:59:00Z"))).toBe(false);
    expect(digestDue(new Date("2026-11-16T12:00:00Z"))).toBe(false);
    expect(digestDue(new Date("2026-11-15T06:00:00Z"))).toBe(false); // Sunday
    expect(digestDue(new Date("2026-11-21T06:00:00Z"))).toBe(false); // Saturday
  });
});

describe("digestPost", () => {
  const zones = [
    z({ kind: "SELL", low: 3905, high: 3960 }),
    z({ kind: "BUY", low: 3740, high: 3760 }),
    z({ kind: "INVALIDATION", low: 3960, high: 3960, direction: "ABOVE", closeTf: "4H" }),
    z({ kind: "TARGET", low: 3815, high: 3825 }),
    z({ symbol: "BTC/USDT", kind: "SELL", low: 69000, high: 70000 }),
    z({ symbol: "DJI", kind: "SELL", low: 52800, high: 53100, state: "ENTERED", signalState: "WAITING_TRIGGER" }),
    z({ symbol: "WTI", kind: "BUY", low: 78.5, high: 80.26, state: "ENTERED", signalState: "OPEN", triggerPrice: 80.1, tpHit: 1 }),
  ];

  it("lists live zones by symbol with the distance, then zones waiting for a trigger and open signals", () => {
    const text = digestPost(zones, { "XAU/USD": 3853, "BTC/USDT": 65000 }, MON, "gheymat_today")!;
    expect(text.split("\n")).toEqual([
      "📋 زون‌های امروز | دوشنبه ۲۵ آبان",
      "━━━━━━━━━━━━━━",
      "",
      "▫️ BTC/USDT — قیمت 65,000",
      "🔴 زون فروش: 69,000 – 70,000 (6.2٪ بالاتر)",
      "",
      "▫️ XAU/USD — قیمت 3,853",
      "🔴 زون فروش: 3,905 – 3,960 (1.3٪ بالاتر)",
      "🟢 زون خرید: 3,740 – 3,760 (2.4٪ پایین‌تر)",
      "❌ ابطال فروش: کلوز 4H بالای 3,960",
      "",
      "⏳ در زون، منتظر تریگر:",
      "   DJI زون فروش 52,800 – 53,100",
      "",
      "✅ سیگنال‌های باز:",
      "   🟢 خرید WTI از 80.1 — TP1 خورده، ریسک‌فری",
      "━━━━━━━━━━━━━━",
      "این‌ها سطح‌اند، نه سیگنال ورود. سیگنال فقط وقتی تریگر بیاید جداگانه پست می‌شود.",
      "",
      "@gheymat_today",
    ]);
  });

  it("says when price is inside a zone, and leaves out the distance without a price", () => {
    const text = digestPost([z({ kind: "SELL", low: 3905, high: 3960 })], { "XAU/USD": 3920 }, MON, null)!;
    expect(text).toContain("(قیمت داخل زون است)");
    expect(text).not.toContain("@");
    expect(digestPost([z({ kind: "SELL", low: 3905, high: 3960 })], {}, MON, null)).toContain("🔴 زون فروش: 3,905 – 3,960\n");
  });

  it("has nothing to post when no zone is live and no signal is waiting or open", () => {
    expect(digestPost([z({ kind: "TARGET", low: 1, high: 2 }), z({ kind: "SELL", state: "EXPIRED" })], {}, MON, null)).toBeNull();
  });
});
