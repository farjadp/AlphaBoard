import { describe, expect, it } from "vitest";
import { noTriggerMessage, signalMessage, signalPost, stepMessage, stepPost, zoneMessage } from "@/lib/analyst/message";

const buy = { id: "z1", symbol: "XAU/USD", kind: "BUY" as const, low: 3850, high: 3865, direction: null, closeTf: null, condition: "فقط با تریگر در تایم پایین", explain: "صبر کنید تا کندل برگشتی ببینید." };
const sell = { ...buy, kind: "SELL" as const, low: 3940, high: 3976, condition: null, explain: null };
const invBelow = { id: "z3", symbol: "XAU/USD", kind: "INVALIDATION" as const, low: 3830, high: 3830, direction: "BELOW", closeTf: "4H", condition: null };
const signal = {
  entry: 3874, stop: 3370.38, stopPct: 13, triggerTf: "15M" as const,
  targets: [{ price: 4067.7, pct: 5 }, { price: 4183.92, pct: 8 }],
  risk: { level: "MEDIUM" as const, reasons: ["خلاف روند ۴ساعته", "منبع هنوز آمار کافی ندارد"] },
};

describe("signalPost", () => {
  it("is the public signal: side and symbol, entry, TPs then SL, trigger, zone, risk, invalidation", () => {
    expect(signalPost(buy, signal, invBelow, "gheymat_today").split("\n")).toEqual([
      "🟢 سیگنال خرید | XAU/USD",
      "━━━━━━━━━━━━━━",
      "💵 ورود: 3,874",
      "",
      "🎯 TP1: 4,067.7 (+5%) ✅ ریسک‌فری و سیو سود",
      "🎯 TP2: 4,183.92 (+8%)",
      "🛑 SL: 3,370.38 (-13%)",
      "━━━━━━━━━━━━━━",
      "⚡ تریگر: کلوز بالای سقف 3 کندل ۱۵ دقیقه‌ای قبلی، بدون شکست زون",
      "📍 زون: 3,850 – 3,865",
      "🟡 ریسک: متوسط",
      "   ▫️ خلاف روند ۴ساعته",
      "   ▫️ منبع هنوز آمار کافی ندارد",
      "❌ ابطال: کلوز 4H زیر 3,830",
      "",
      "حجم معامله و مدیریت ریسک با خودتان.",
      "",
      "@gheymat_today",
    ]);
  });

  it("mirrors signs for a sell and drops the handle when there is none", () => {
    const text = signalPost(sell, { ...signal, entry: 3940, stop: 4452.2, targets: [{ price: 3743, pct: 5 }] }, null, null);
    expect(text).toContain("🔴 سیگنال فروش | XAU/USD");
    expect(text).toContain("🎯 TP1: 3,743 (-5%) ✅ ریسک‌فری و سیو سود");
    expect(text).toContain("🛑 SL: 4,452.2 (+13%)");
    expect(text).toContain("کلوز زیر کف 3 کندل");
    expect(text).not.toContain("@");
  });
});

describe("steps", () => {
  it("are short replies; TP1 says to move the stop to entry", () => {
    expect(stepPost(buy, signal, { kind: "TP", index: 0 })).toBe("🎯 TP1 خورد | XAU/USD (+5%)\nحد ضرر را به نقطه‌ی ورود (3,874) ببرید و بخشی از سود را سیو کنید.");
    expect(stepPost(buy, signal, { kind: "TP", index: 1 })).toBe("🎯 TP2 خورد | XAU/USD (+8%)\nقیمت: 4,183.92");
    expect(stepPost(buy, signal, { kind: "STOP" })).toBe("🛑 SL خورد | XAU/USD (-13%)\nسیگنال بسته شد.");
    expect(stepPost(buy, signal, { kind: "BREAKEVEN" })).toBe("⚪ ریسک‌فری بسته شد | XAU/USD\nبعد از TP1 قیمت به نقطه‌ی ورود (3,874) برگشت.");
    expect(stepPost(buy, signal, { kind: "ALL_TP" })).toBe("🏁 همه‌ی تارگت‌ها خورد | XAU/USD\nسیگنال بسته شد.");
    expect(stepPost(buy, signal, { kind: "BROKEN", level: invBelow })).toBe("⛔ سناریو باطل شد | XAU/USD\n❌ کلوز 4H زیر 3,830\nخروج یا مدیریت پوزیشن را در نظر بگیرید.");
    expect(stepPost(sell, signal, { kind: "TP", index: 0 })).toContain("(-5%)");
  });

  it("tell the owner too, with the source", () => {
    const m = stepMessage(buy, signal, { kind: "STOP" }, { planId: "p", source: "Nima" });
    expect(m.title).toBe("🛑 SL خورد | XAU/USD (-13%)");
    expect(m.body).toBe("📌 منبع: Nima\nسیگنال بسته شد.");
  });
});

describe("owner messages", () => {
  const ctx = { planId: "p1", source: "Nima", price: 3860, agrees: ["Me"], newsRisk: null, invalidation: invBelow, triggerTf: "15M" as const };

  it("zone reached: wait for the trigger, says what the trigger is", () => {
    const m = zoneMessage("ENTERED", buy, ctx);
    expect(m.title).toBe("⏳ XAU/USD وارد زون خرید 3,850 – 3,865 شد — منتظر تریگر");
    expect(m.body.split("\n")).toEqual([
      "📌 منبع: Nima",
      "🤝 هم‌نظر: Me",
      "💵 قیمت الان: 3,860",
      "⚡ تریگر سیستم: کلوز بالای سقف 3 کندل ۱۵ دقیقه‌ای قبلی، بدون شکست زون",
      "⏳ شرط تحلیلگر: فقط با تریگر در تایم پایین",
      "💡 صبر کنید تا کندل برگشتی ببینید.",
      "❌ ابطال: کلوز 4H زیر 3,830",
      "هنوز وارد نشو؛ وقتی تریگر بیاید پیام «✅ وارد شو» می‌گیری.",
      "",
      "این فقط هشدار است؛ هیچ سفارشی ثبت نشده.",
    ]);
  });

  it("trigger fired: enter now, with the full signal", () => {
    const m = signalMessage(buy, signal, ctx);
    expect(m.title).toBe("✅ تریگر خرید XAU/USD فعال شد — وارد شو");
    expect(m.body).toContain("💵 ورود: 3,874");
    expect(m.body).toContain("🛑 SL: 3,370.38 (-13%)");
    expect(m.data).toEqual({ planId: "p1", zoneId: "z1", symbol: "XAU/USD", price: 3874, href: "/admin/analyst" });
  });

  it("no trigger, analyst target, broken scenario", () => {
    expect(noTriggerMessage(buy, "CANCELLED", 3845, ctx).body).toBe("📌 منبع: Nima\nقیمت زیر زون 3,850 – 3,865 بسته شد (3,845)؛ این ستاپ دیگر معتبر نیست.");
    expect(noTriggerMessage(buy, "EXPIRED", null, ctx).title).toBe("✖️ تریگر خرید XAU/USD نیامد");
    expect(zoneMessage("HIT", { ...buy, kind: "TARGET", low: 1.346, high: 1.348, symbol: "GBP/USD" }, { ...ctx, price: 1.3462 }).title).toBe("🎯 GBP/USD به تارگت تحلیل 1.346 – 1.348 رسید");
    expect(zoneMessage("BROKEN", invBelow, { ...ctx, price: 3825 }).title).toBe("⛔ XAU/USD: سناریو باطل شد");
  });
});
