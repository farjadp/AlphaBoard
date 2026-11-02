import { describe, expect, it } from "vitest";
import { exitsFor, riskLevel } from "@/lib/analyst/exits";

describe("exitsFor", () => {
  it("places the stop and targets as percents of the entry price", () => {
    const e = exitsFor("BUY", 3860, 13, [5, 8, 34, 55]);
    expect(e.stop).toBeCloseTo(3358.2, 6);
    expect(e.targets.map((t) => Number(t.toFixed(4)))).toEqual([4053, 4168.8, 5172.4, 5983]);
  });

  it("mirrors for a sell", () => {
    const e = exitsFor("SELL", 100, 13, [5, 55]);
    expect(e.stop).toBeCloseTo(113, 9);
    expect(e.targets.map((t) => Number(t.toFixed(9)))).toEqual([95, 45]);
  });

  it("drops targets that would cross zero", () => {
    expect(exitsFor("SELL", 100, 13, [5, 100, 120]).targets.map((t) => Number(t.toFixed(9)))).toEqual([95]);
  });
});

describe("riskLevel", () => {
  const base = { side: "BUY" as const, trend4h: "Bullish", newsRisk: null, atr1h: 10, lastHourRange: 8, record: null };

  it("is low when nothing counts against the trade, and says why", () => {
    expect(riskLevel(base)).toEqual({ level: "LOW", reasons: ["هم‌جهت با روند ۴ساعته", "منبع هنوز آمار کافی ندارد"] });
  });

  it("adds a point for each risk: against the 4H trend, news, a fast move", () => {
    expect(riskLevel({ ...base, trend4h: "Bearish" })).toMatchObject({ level: "MEDIUM", reasons: ["خلاف روند ۴ساعته", "منبع هنوز آمار کافی ندارد"] });
    expect(riskLevel({ ...base, trend4h: "Bearish", newsRisk: "NFP", lastHourRange: 25 })).toMatchObject({
      level: "HIGH",
      reasons: ["خلاف روند ۴ساعته", "خبر مهم نزدیک است: NFP", "ورود با حرکت تند (بیش از ۲ برابر ATR یک‌ساعته)", "منبع هنوز آمار کافی ندارد"],
    });
  });

  it("counts the source's record once it has 30 reached zones", () => {
    expect(riskLevel({ ...base, record: { touched: 40, respected: 14 } })).toMatchObject({ level: "MEDIUM", reasons: ["هم‌جهت با روند ۴ساعته", "کارنامه‌ی ضعیف منبع: 35٪ از 40 زون"] });
    expect(riskLevel({ ...base, trend4h: "Bearish", record: { touched: 30, respected: 20 } })).toMatchObject({ level: "LOW", reasons: ["خلاف روند ۴ساعته", "کارنامه‌ی خوب منبع: 67٪ از 30 زون"] });
    expect(riskLevel({ ...base, record: { touched: 29, respected: 0 } }).reasons).toContain("منبع هنوز آمار کافی ندارد");
  });

  it("says nothing about a neutral or unknown trend and skips the ATR check without data", () => {
    expect(riskLevel({ ...base, trend4h: "Neutral", atr1h: null })).toEqual({ level: "LOW", reasons: ["منبع هنوز آمار کافی ندارد"] });
  });
});
