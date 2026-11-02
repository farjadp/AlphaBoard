import { describe, expect, it } from "vitest";
import { channelMessage, zoneMessage } from "@/lib/analyst/message";

const sell = { id: "z1", symbol: "XAU/USD", kind: "SELL" as const, low: 3940, high: 3976, direction: null, closeTf: null, condition: "only with a 15m trigger", note: null };
const inv = { id: "z2", symbol: "XAU/USD", kind: "INVALIDATION" as const, low: 3976, high: 3976, direction: "ABOVE", closeTf: "4H", condition: null, note: null };

describe("zoneMessage", () => {
  it("describes a sell zone entry with consensus, condition, invalidation and news risk", () => {
    const m = zoneMessage("ENTERED", sell, { planId: "p1", source: "Nima Razzaghi", price: 3944.5, agrees: ["Me"], newsRisk: "NFP", invalidation: inv });
    expect(m.type).toBe("analyst_zone");
    expect(m.title).toBe("🟥 XAU/USD وارد زون فروش 3,940–3,976 شد");
    expect(m.body.split("\n")).toEqual([
      "منبع: Nima Razzaghi · قیمت: 3,944.5",
      "هم‌نظر: Me",
      "شرط ورود: only with a 15m trigger",
      "ابطال: کلوز 4H بالای 3,976",
      "⚠️ ریسک خبر: NFP",
      "این فقط هشدار است؛ هیچ سفارشی ثبت نشده.",
    ]);
    expect(m.data).toEqual({ planId: "p1", zoneId: "z1", symbol: "XAU/USD", price: 3944.5, href: "/admin/analyst" });
  });

  it("keeps a bare buy entry short", () => {
    const m = zoneMessage("ENTERED", { ...sell, kind: "BUY", low: 1.158, high: 1.16, symbol: "EUR/USD", condition: null }, { planId: "p", source: "X", price: 1.1595, agrees: [], newsRisk: null, invalidation: null });
    expect(m.title).toBe("🟩 EUR/USD وارد زون خرید 1.158–1.16 شد");
    expect(m.body).toBe("منبع: X · قیمت: 1.1595\nاین فقط هشدار است؛ هیچ سفارشی ثبت نشده.");
  });

  it("names a reached target and a broken scenario", () => {
    const t = zoneMessage("HIT", { ...sell, kind: "TARGET", low: 3740, high: 3740 }, { planId: "p", source: "X", price: 3740, agrees: [], newsRisk: null, invalidation: null });
    expect(t.title).toBe("🎯 XAU/USD به تارگت 3,740 رسید");
    const b = zoneMessage("BROKEN", inv, { planId: "p", source: "X", price: 3985, agrees: [], newsRisk: null, invalidation: null });
    expect(b.title).toBe("⛔ XAU/USD: سناریو باطل شد (کلوز 4H بالای 3,976)");
    expect(b.body).toBe("منبع: X · کلوز: 3,985\nزون‌های دیگر این نماد در این پلن را با احتیاط ببینید.");
  });
});

describe("channelMessage", () => {
  it("is a public post: drops private context and the source, says it is not an entry signal", () => {
    const text = channelMessage("ENTERED", sell, { planId: "p1", source: "نیما رزاقی", price: 3944.5, agrees: ["Me"], newsRisk: "NFP", invalidation: inv }, "gheymat_today");
    expect(text.split("\n")).toEqual([
      "🟥 XAU/USD وارد زون فروش 3,940–3,976 شد",
      "قیمت: 3,944.5",
      "شرط ورود: only with a 15m trigger",
      "ابطال: کلوز 4H بالای 3,976",
      "⚠️ ریسک خبر: NFP",
      "",
      "این هشدارِ رسیدن قیمت به یک سطح است، نه سیگنال ورود. تصمیم و مدیریت ریسک با خودتان.",
      "@gheymat_today",
    ]);
  });

  it("covers a broken scenario and works without a channel username", () => {
    const text = channelMessage("BROKEN", inv, { planId: "p", source: "X", price: 3985, agrees: [], newsRisk: null, invalidation: null }, null);
    expect(text.split("\n")).toEqual([
      "⛔ XAU/USD: سناریو باطل شد (کلوز 4H بالای 3,976)",
      "کلوز: 3,985",
      "",
      "این هشدارِ رسیدن قیمت به یک سطح است، نه سیگنال ورود. تصمیم و مدیریت ریسک با خودتان.",
    ]);
  });
});

describe("trade lines", () => {
  const trade = {
    stop: 3358.2, stopPct: 13,
    targets: [{ price: 4053, pct: 5 }, { price: 4168.8, pct: 8 }, { price: 5172.4, pct: 34 }, { price: 5983, pct: 55 }],
    risk: { level: "MEDIUM" as const, reasons: ["خلاف روند ۴ساعته", "منبع هنوز آمار کافی ندارد"] },
  };
  const buy = { ...sell, kind: "BUY" as const, low: 3850, high: 3865, explain: "صبر کنید تا در تایم ۱۵ دقیقه کندل برگشتی ببینید." };

  it("adds the explanation, stop, targets (first one = risk-free) and risk to a zone entry", () => {
    const text = channelMessage("ENTERED", buy, { planId: "p", source: "X", price: 3860, agrees: [], newsRisk: null, invalidation: inv, trade }, "gheymat_today");
    expect(text.split("\n")).toEqual([
      "🟩 XAU/USD وارد زون خرید 3,850–3,865 شد",
      "قیمت: 3,860",
      "شرط ورود: only with a 15m trigger",
      "توضیح: صبر کنید تا در تایم ۱۵ دقیقه کندل برگشتی ببینید.",
      "حد ضرر: 3,358.2 (13%)",
      "حد سود 1: 4,053 (5%) — ریسک‌فری و سیو سود",
      "حد سود 2: 4,168.8 (8%)",
      "حد سود 3: 5,172.4 (34%)",
      "حد سود 4: 5,983 (55%)",
      "ریسک: متوسط — خلاف روند ۴ساعته، منبع هنوز آمار کافی ندارد",
      "ابطال: کلوز 4H بالای 3,976",
      "",
      "ورود فقط بعد از دیدن شرط ورود. حجم معامله و مدیریت ریسک با خودتان.",
      "@gheymat_today",
    ]);
  });

  it("keeps the private message's footer and source", () => {
    const m = zoneMessage("ENTERED", buy, { planId: "p", source: "X", price: 3860, agrees: [], newsRisk: null, invalidation: null, trade });
    expect(m.body.split("\n")[0]).toBe("منبع: X · قیمت: 3,860");
    expect(m.body).toContain("حد سود 1: 4,053 (5%) — ریسک‌فری و سیو سود");
    expect(m.body.split("\n").at(-1)).toBe("این فقط هشدار است؛ هیچ سفارشی ثبت نشده.");
  });
});
