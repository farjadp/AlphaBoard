import { describe, expect, it } from "vitest";
import { zoneMessage } from "@/lib/analyst/message";

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
