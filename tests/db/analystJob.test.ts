/** P18a against Postgres: the tick's analyst-zone step with injected candles and a fake Telegram bot. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { evaluateZones } from "@/lib/analyst/job";
import { activatePlan, createPlan } from "@/lib/analyst/store";
import type { Bar } from "@/lib/analyst/zones";
import type { Telegram } from "@/lib/notify/telegram";

const run = !!process.env.TEST_DATABASE_URL;
const H = 3_600_000;
const M5 = 300_000;
const T0 = Date.UTC(2026, 10, 2, 0); // Monday 00:00 UTC

function fakeBot() {
  const sent: string[] = [];
  const bot: Telegram = { username: async () => "t", updates: async () => [], send: async (_c, text) => { sent.push(text); } };
  return { bot, sent };
}
const flat = (time: number, p: number): Bar => ({ time, open: p, high: p, low: p, close: p });

describe.skipIf(!run)("analyst zone job (Postgres)", () => {
  let A: string;
  const tg = fakeBot();

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "aj@test.local", passwordHash: "x", telegramChatId: "42" } })).id;
  });
  beforeEach(async () => {
    await prisma.analystPlan.deleteMany({});
    await prisma.notification.deleteMany({});
    tg.sent.length = 0;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function goldPlan(extra: Record<string, unknown> = {}) {
    const p = await createPlan(A, {
      source: "Nima Razzaghi", expiresAt: "2026-11-07T00:00:00Z", offsets: { "XAU/USD": 20 },
      events: [{ at: new Date(T0 + 2 * H).toISOString(), label: "NFP" }],
      zones: [
        { symbol: "XAU/USD", kind: "SELL", low: 3940, high: 3976, condition: "15m trigger" },
        { symbol: "XAU/USD", kind: "INVALIDATION", low: 3976, high: 3976, direction: "ABOVE", closeTf: "4H" },
        { symbol: "XAU/USD", kind: "TARGET", low: 3740, high: 3760 },
      ],
      ...extra,
    });
    return activatePlan(A, p.id, new Date(T0));
  }

  it("notifies once when price enters a zone, with the analyst-basis price and the plan's context", async () => {
    const p = await goldPlan();
    // Feed 3965 − offset 20 = 3945: inside the sell zone.
    const bars = [flat(T0, 3930), flat(T0 + M5, 3950), { time: T0 + 2 * M5, open: 3950, high: 3965, low: 3948, close: 3960 }];
    const deps = { barsOf: async () => bars, barsTfOf: async () => [], priceOf: async () => 3958, telegram: tg.bot };
    const r1 = await evaluateZones({ ...deps, now: new Date(T0 + 3 * M5) });
    expect(r1).toMatchObject({ active: 1, entered: 1, errors: [] });
    const r2 = await evaluateZones({ ...deps, now: new Date(T0 + 4 * M5) });
    expect(r2.entered).toBe(0);
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]).toContain("وارد زون فروش 3,940 – 3,976 شد — منتظر تریگر");
    expect(tg.sent[0]).toContain("💵 قیمت الان: 3,940");
    expect(tg.sent[0]).toContain("❌ ابطال: کلوز 4H بالای 3,976");
    expect(tg.sent[0]).toContain("خبر مهم نزدیک است: NFP");
    const z = await prisma.analystZone.findFirstOrThrow({ where: { planId: p.id, kind: "SELL" } });
    expect(z).toMatchObject({ state: "ENTERED", enteredPrice: 3940 });
  });

  it("posts nothing to the channel on a zone touch or an analyst target", async () => {
    const posts: string[] = [];
    const channel = { post: async (text: string) => { posts.push(text); return 77; }, reply: async () => 0 };
    await goldPlan({ postToChannel: true, zones: [
      { symbol: "XAU/USD", kind: "SELL", low: 3940, high: 3976 },
      { symbol: "XAU/USD", kind: "TARGET", low: 3930, high: 3950 },
    ] });
    const bars = [{ time: T0, open: 3960, high: 3965, low: 3955, close: 3960 }];
    const r = await evaluateZones({ now: new Date(T0 + M5), barsOf: async () => bars, barsTfOf: async () => [], priceOf: async () => null, telegram: tg.bot, channel, channelUsername: "gheymat_today" });
    expect(r.entered).toBe(2);
    expect(posts).toEqual([]);
    expect(tg.sent.join("\n")).toContain("منتظر تریگر");
    expect(tg.sent.join("\n")).toContain("به تارگت تحلیل");
  });

  describe("signals", () => {
    const M15 = 900_000;
    const m15 = (i: number, high: number, low: number, close: number): Bar => ({ time: T0 + i * M15, open: close, high, low, close });
    // Three candles before the touch (highs 3880, 3872, 3866), the touch candle, then a close above 3872.
    const fifteen = [m15(-3, 3880, 3874, 3876), m15(-2, 3872, 3866, 3868), m15(-1, 3866, 3858, 3862), m15(0, 3866, 3852, 3860), m15(1, 3884, 3858, 3882)];
    const plan = () => goldPlan({ offsets: {}, events: [], postToChannel: true, stopPct: 13, targetPcts: [1, 2], zones: [
      { symbol: "XAU/USD", kind: "BUY", low: 3850, high: 3865, condition: "15m trigger" },
      { symbol: "XAU/USD", kind: "INVALIDATION", low: 3830, high: 3830, direction: "BELOW", closeTf: "4H" },
    ] });

    it("waits for the trigger, posts the signal once, then threads TP1 and breakeven under it", async () => {
      const posts: string[] = [];
      const replies: Array<{ to: number; text: string }> = [];
      const channel = { post: async (text: string) => { posts.push(text); return 501; }, reply: async (to: number, text: string) => { replies.push({ to, text }); return 0; } };
      const p = await plan();
      const tfBars = async (_s: string, tf: string) => (tf === "15M" ? fifteen : []);
      const base = { barsTfOf: tfBars, priceOf: async () => null, telegram: tg.bot, channel, channelUsername: "gheymat_today" };

      // Touch at T0; no closed 15m candle after it yet.
      const r1 = await evaluateZones({ ...base, now: new Date(T0 + M15 - 1), barsOf: async () => [flat(T0, 3860)] });
      expect(r1).toMatchObject({ entered: 1, triggered: 0 });
      expect(posts).toEqual([]);

      // The 15m candle at T0+15m closes 3882 > 3872: trigger, entry 3882.
      const r2 = await evaluateZones({ ...base, now: new Date(T0 + 2 * M15), barsOf: async () => [flat(T0, 3860)] });
      expect(r2.triggered).toBe(1);
      expect(posts).toHaveLength(1);
      expect(posts[0].split("\n").slice(0, 7)).toEqual([
        "🟢 سیگنال خرید | XAU/USD", "━━━━━━━━━━━━━━", "💵 ورود: 3,882", "", "🎯 TP1: 3,920.82 (+1%) ✅ ریسک‌فری و سیو سود", "🎯 TP2: 3,959.64 (+2%)", "🛑 SL: 3,377.34 (-13%)",
      ]);
      expect(posts[0]).toContain("❌ ابطال: کلوز 4H زیر 3,830");
      expect(tg.sent.some((m) => m.includes("✅ تریگر خرید XAU/USD فعال شد — وارد شو"))).toBe(true);
      const z = await prisma.analystZone.findFirstOrThrow({ where: { planId: p.id, kind: "BUY" } });
      expect(z).toMatchObject({ signalState: "OPEN", triggerPrice: 3882, channelMessageId: 501, tpHit: 0 });

      // TP1 at T0+30m, then back to the entry: breakeven.
      const after = [{ time: T0 + 2 * M15, open: 3890, high: 3925, low: 3889, close: 3920 }, { time: T0 + 2 * M15 + M5, open: 3920, high: 3921, low: 3881, close: 3885 }];
      const r3 = await evaluateZones({ ...base, now: new Date(T0 + 2 * M15 + 2 * M5), barsOf: async () => after });
      expect(r3.steps).toBe(2);
      expect(replies.map((x) => x.to)).toEqual([501, 501]);
      expect(replies[0].text).toBe("🎯 TP1 خورد | XAU/USD (+1%)\nحد ضرر را به نقطه‌ی ورود (3,882) ببرید و بخشی از سود را سیو کنید.");
      expect(replies[1].text).toContain("⚪ ریسک‌فری بسته شد | XAU/USD");
      expect(await prisma.analystZone.findUniqueOrThrow({ where: { id: z.id } })).toMatchObject({ signalState: "BREAKEVEN", tpHit: 1 });

      // Nothing repeats.
      const sentBefore = tg.sent.length;
      const r4 = await evaluateZones({ ...base, now: new Date(T0 + 3 * M15), barsOf: async () => after });
      expect(r4).toMatchObject({ triggered: 0, steps: 0 });
      expect(replies).toHaveLength(2);
      expect(tg.sent).toHaveLength(sentBefore);
    });

    it("a close below the zone before the trigger cancels it, privately", async () => {
      const posts: string[] = [];
      const channel = { post: async (text: string) => { posts.push(text); return 1; }, reply: async () => 0 };
      const p = await plan();
      const broken = [...fifteen.slice(0, 4), m15(1, 3862, 3840, 3845)];
      await evaluateZones({ now: new Date(T0 + 2 * M15), barsOf: async () => [flat(T0, 3860)], barsTfOf: async (_s, tf) => (tf === "15M" ? broken : []), priceOf: async () => null, telegram: tg.bot, channel });
      expect(posts).toEqual([]);
      expect(tg.sent.at(-1)).toContain("قیمت زیر زون 3,850 – 3,865 بسته شد (3,845)");
      expect((await prisma.analystZone.findFirstOrThrow({ where: { planId: p.id, kind: "BUY" } })).signalState).toBe("CANCELLED");
    });

    it("keeps a failed signal post on the zone", async () => {
      const p = await plan();
      const bad = { post: async () => { throw new Error("Forbidden: bot is not a member of the channel"); }, reply: async () => 0 };
      const r = await evaluateZones({ now: new Date(T0 + 2 * M15), barsOf: async () => [flat(T0, 3860)], barsTfOf: async (_s, tf) => (tf === "15M" ? fifteen : []), priceOf: async () => null, telegram: null, channel: bad });
      expect(r.triggered).toBe(1);
      expect((await prisma.analystZone.findFirstOrThrow({ where: { planId: p.id, kind: "BUY" } })).channelError).toMatch(/not a member/);
    });
  });

  it("shows only the invalidation that fits the zone's side", async () => {
    await goldPlan({ zones: [
      { symbol: "XAU/USD", kind: "BUY", low: 3850, high: 3865 },
      { symbol: "XAU/USD", kind: "INVALIDATION", low: 3976, high: 3976, direction: "ABOVE", closeTf: "4H" },
      { symbol: "XAU/USD", kind: "INVALIDATION", low: 3830, high: 3830, direction: "BELOW", closeTf: "4H" },
    ] });
    // Feed 3880 − offset 20 = 3860: inside the buy zone.
    await evaluateZones({ now: new Date(T0 + M5), barsOf: async () => [flat(T0, 3880)], barsTfOf: async () => [], priceOf: async () => null, telegram: tg.bot, channel: null });
    expect(tg.sent).toHaveLength(1);
    expect(tg.sent[0]).toContain("❌ ابطال: کلوز 4H زیر 3,830");
    expect(tg.sent[0]).not.toContain("بالای 3,976");
  });

  it("breaks an invalidation only on a closed candle of its timeframe", async () => {
    const p = await goldPlan();
    const fourH = [{ time: T0, open: 3990, high: 4010, low: 3985, close: 4005 }]; // 4005 − 20 = 3985 > 3976
    const deps = { barsOf: async () => [], barsTfOf: async () => fourH, priceOf: async () => null, telegram: tg.bot };
    expect((await evaluateZones({ ...deps, now: new Date(T0 + 3 * H) })).broken).toBe(0);
    expect((await evaluateZones({ ...deps, now: new Date(T0 + 4 * H) })).broken).toBe(1);
    expect(tg.sent[0]).toContain("سناریو باطل شد");
    expect(tg.sent[0]).toContain("💵 کلوز: 3,985");
    expect((await prisma.analystZone.findFirstOrThrow({ where: { planId: p.id, kind: "INVALIDATION" } })).state).toBe("BROKEN");
  });

  it("scores the reaction after a touch from 1H candles", async () => {
    const p = await goldPlan();
    const sell = (await prisma.analystZone.findFirstOrThrow({ where: { planId: p.id, kind: "SELL" } }));
    await prisma.analystZone.update({ where: { id: sell.id }, data: { state: "ENTERED", enteredAt: new Date(T0), enteredPrice: 3945 } });
    // Feed low 3920 − 20 = 3900: 40 below the near edge 3940 ≥ the zone width 36.
    const oneH = [{ time: T0, open: 3965, high: 3970, low: 3920, close: 3925 }];
    const r = await evaluateZones({ now: new Date(T0 + H), barsOf: async () => [], barsTfOf: async (_s, tf) => (tf === "1H" ? oneH : []), priceOf: async () => null, telegram: null });
    expect(r.scored).toBe(1);
    expect(await prisma.analystZone.findUniqueOrThrow({ where: { id: sell.id } })).toMatchObject({ state: "SCORED", outcome: "RESPECTED", mfe: 40, mae: 10 });
  });

  it("marks a reached target as hit, and closes the week with untouched and missed outcomes", async () => {
    const p = await goldPlan({ zones: [
      { symbol: "XAU/USD", kind: "TARGET", low: 3740, high: 3760 },
      { symbol: "XAU/USD", kind: "BUY", low: 3600, high: 3620 },
      { symbol: "XAU/USD", kind: "TARGET", low: 3500, high: 3500 },
    ] });
    await evaluateZones({ now: new Date(T0 + M5), barsOf: async () => [flat(T0, 3775)], barsTfOf: async () => [], priceOf: async () => null, telegram: tg.bot });
    expect(tg.sent[0]).toContain("به تارگت تحلیل 3,740 – 3,760 رسید");
    const r = await evaluateZones({ now: new Date("2026-11-07T00:00:00Z"), barsOf: async () => [], barsTfOf: async () => [], priceOf: async () => null, telegram: tg.bot });
    expect(r.expired).toBe(1);
    const zones = await prisma.analystZone.findMany({ where: { planId: p.id }, orderBy: { low: "desc" } });
    expect(zones.map((z) => z.outcome)).toEqual(["HIT", "UNTOUCHED", "MISSED"]);
    expect((await prisma.analystPlan.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("ARCHIVED");
  });

  it("ignores drafts and keeps going when one symbol's data fails", async () => {
    await createPlan(A, { source: "Draft", expiresAt: "2026-11-07T00:00:00Z", zones: [{ symbol: "BTC/USDT", kind: "BUY", low: 1, high: 1e9 }] });
    await goldPlan({ zones: [{ symbol: "BTC/USDT", kind: "BUY", low: 72000, high: 75000 }, { symbol: "XAU/USD", kind: "SELL", low: 3940, high: 3976 }] });
    const r = await evaluateZones({
      now: new Date(T0 + M5),
      barsOf: async (s) => { if (s === "BTC/USDT") throw new Error("binance down"); return [flat(T0, 3970)]; },
      barsTfOf: async () => [], priceOf: async () => null, telegram: null,
    });
    expect(r.entered).toBe(1);
    expect(r.errors.join(" ")).toMatch(/binance down/);
  });
});
