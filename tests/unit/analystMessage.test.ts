import { describe, expect, it } from "vitest";
import { channelMessage, zoneMessage } from "@/lib/analyst/message";

const sell = { id: "z1", symbol: "XAU/USD", kind: "SELL" as const, low: 3940, high: 3976, direction: null, closeTf: null, condition: "only with a 15m trigger", note: null };
const buy = { ...sell, kind: "BUY" as const, low: 3850, high: 3865, condition: "فقط با تریگر در تایم پایین", explain: "صبر کنید تا در تایم ۱۵ دقیقه کندل برگشتی ببینید." };
const invAbove = { id: "z2", symbol: "XAU/USD", kind: "INVALIDATION" as const, low: 3976, high: 3976, direction: "ABOVE", closeTf: "4H", condition: null, note: null };
const invBelow = { ...invAbove, id: "z3", low: 3830, high: 3830, direction: "BELOW" };
const trade = {
  stop: 3358.2, stopPct: 13,
  targets: [{ price: 4053, pct: 5 }, { price: 4168.8, pct: 8 }, { price: 5172.4, pct: 34 }, { price: 5983, pct: 55 }],
  risk: { level: "MEDIUM" as const, reasons: ["خلاف روند ۴ساعته", "منبع هنوز آمار کافی ندارد"] },
};
const ctx = { planId: "p1", source: "Nima", price: 3860, agrees: [] as string[], newsRisk: null as string | null, invalidation: null as typeof invAbove | null };

describe("channelMessage", () => {
  it("lays out a buy entry: header, zone and price, TPs then SL, conditions, risk, invalidation, footer", () => {
    const text = channelMessage("ENTERED", buy, { ...ctx, invalidation: invBelow, trade }, "gheymat_today");
    expect(text.split("\n")).toEqual([
      "🟢 XAU/USD | ورود به زون خرید",
      "━━━━━━━━━━━━━━",
      "📍 ناحیه‌ی ورود: 3,850 – 3,865",
      "💵 قیمت الان: 3,860",
      "",
      "🎯 TP1: 4,053 (+5%) ✅ ریسک‌فری و سیو سود",
      "🎯 TP2: 4,168.8 (+8%)",
      "🎯 TP3: 5,172.4 (+34%)",
      "🎯 TP4: 5,983 (+55%)",
      "🛑 SL: 3,358.2 (-13%)",
      "━━━━━━━━━━━━━━",
      "⏳ شرط ورود: فقط با تریگر در تایم پایین",
      "💡 صبر کنید تا در تایم ۱۵ دقیقه کندل برگشتی ببینید.",
      "🟡 ریسک: متوسط",
      "   ▫️ خلاف روند ۴ساعته",
      "   ▫️ منبع هنوز آمار کافی ندارد",
      "❌ ابطال: کلوز 4H زیر 3,830",
      "",
      "ورود فقط بعد از دیدن شرط ورود.",
      "حجم معامله و مدیریت ریسک با خودتان.",
      "",
      "@gheymat_today",
    ]);
  });

  it("signs a sell's targets down and its stop up", () => {
    const t = { ...trade, stop: 4452.2, targets: [{ price: 3743, pct: 5 }], risk: { level: "LOW" as const, reasons: [] } };
    const text = channelMessage("ENTERED", sell, { ...ctx, price: 3940, trade: t }, null);
    expect(text).toContain("🔴 XAU/USD | ورود به زون فروش");
    expect(text).toContain("🎯 TP1: 3,743 (-5%) ✅ ریسک‌فری و سیو سود");
    expect(text).toContain("🛑 SL: 4,452.2 (+13%)");
    expect(text).toContain("🟢 ریسک: کم");
    expect(text).not.toContain("@");
  });

  it("without exits it is a level alert, with a news line and its own footer", () => {
    const text = channelMessage("ENTERED", { ...sell, condition: null }, { ...ctx, price: 3944.5, newsRisk: "NFP" }, null);
    expect(text.split("\n")).toEqual([
      "🔴 XAU/USD | ورود به زون فروش",
      "━━━━━━━━━━━━━━",
      "📍 ناحیه‌ی ورود: 3,940 – 3,976",
      "💵 قیمت الان: 3,944.5",
      "━━━━━━━━━━━━━━",
      "⚠️ خبر مهم نزدیک است: NFP",
      "",
      "این هشدارِ رسیدن قیمت به یک سطح است، نه سیگنال ورود.",
      "تصمیم و مدیریت ریسک با خودتان.",
    ]);
  });

  it("covers a reached target and a broken scenario", () => {
    expect(channelMessage("HIT", { ...sell, kind: "TARGET", low: 3740, high: 3760 }, { ...ctx, price: 3741 }, "gheymat_today").split("\n")).toEqual([
      "🎯 XAU/USD | تارگت خورد", "━━━━━━━━━━━━━━", "📍 تارگت: 3,740 – 3,760", "💵 قیمت: 3,741", "", "@gheymat_today",
    ]);
    expect(channelMessage("BROKEN", invAbove, { ...ctx, price: 3985 }, null).split("\n")).toEqual([
      "⛔ XAU/USD | سناریو باطل شد", "━━━━━━━━━━━━━━", "❌ کلوز 4H بالای 3,976", "💵 کلوز: 3,985", "⚠️ پوزیشن‌های باز این نماد را بازبینی کنید.",
    ]);
  });
});

describe("zoneMessage", () => {
  it("is the same layout for the owner, with source, agreement and the private footer", () => {
    const m = zoneMessage("ENTERED", buy, { ...ctx, agrees: ["Me"], trade });
    expect(m.type).toBe("analyst_zone");
    expect(m.title).toBe("🟢 XAU/USD وارد زون خرید 3,850 – 3,865 شد");
    const lines = m.body.split("\n");
    expect(lines.slice(0, 4)).toEqual(["📌 منبع: Nima", "🤝 هم‌نظر: Me", "📍 ناحیه‌ی ورود: 3,850 – 3,865", "💵 قیمت الان: 3,860"]);
    expect(lines).toContain("🛑 SL: 3,358.2 (-13%)");
    expect(lines.at(-1)).toBe("این فقط هشدار است؛ هیچ سفارشی ثبت نشده.");
    expect(m.data).toEqual({ planId: "p1", zoneId: "z1", symbol: "XAU/USD", price: 3860, href: "/admin/analyst" });
  });

  it("titles a target and a broken scenario", () => {
    expect(zoneMessage("HIT", { ...sell, kind: "TARGET", low: 3740, high: 3740 }, ctx).title).toBe("🎯 XAU/USD به تارگت 3,740 رسید");
    expect(zoneMessage("BROKEN", invAbove, { ...ctx, price: 3985 }).title).toBe("⛔ XAU/USD: سناریو باطل شد");
  });
});
