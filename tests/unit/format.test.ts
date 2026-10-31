import { describe, expect, it } from "vitest";
import { amount, hhmm, money, pctOrNa, price, rText, signedPct, timeAgo, usd, usdCost } from "@/lib/format";

describe("format", () => {
  it("money uses a true minus sign and never shows 0 for missing values", () => {
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(usd(-3.2)).toBe("−$3.20");
    expect(usd(3.2, true)).toBe("+$3.20");
    expect(usd(null)).toBe("Unavailable");
    expect(amount(-10)).toBe("−10.00");
    expect(money(12.345, { currency: "CAD" })).toBe("12.35 CAD");
    expect(usdCost(0.0123)).toBe("$0.0123");
    expect(usdCost(2)).toBe("$2.00");
  });

  it("percent, price and R", () => {
    expect(signedPct(1.234)).toBe("+1.23%");
    expect(signedPct(-0.4, 1)).toBe("−0.4%");
    expect(pctOrNa(0)).toBe("0.00%");
    expect(pctOrNa(undefined)).toBe("Unavailable");
    expect(price(1234.5678)).toBe("1,234.57");
    expect(price(1.23456)).toBe("1.2346");
    expect(price(null)).toBe("—");
    expect(rText(1.5)).toBe("+1.50R");
    expect(rText(-1)).toBe("−1.00R");
    expect(rText(null)).toBe("—");
  });

  it("dates", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    expect(timeAgo("2026-10-31T11:57:00Z", now)).toBe("3 min ago");
    expect(timeAgo("2026-10-30T11:00:00Z", now)).toBe("1 d ago");
    expect(hhmm("2026-10-31T12:05:00Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
