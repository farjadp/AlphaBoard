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
    expect(tg.sent[0]).toContain("وارد زون فروش 3,940–3,976");
    expect(tg.sent[0]).toContain("قیمت: 3,940");
    expect(tg.sent[0]).toContain("ابطال: کلوز 4H بالای 3,976");
    expect(tg.sent[0]).toContain("ریسک خبر: NFP");
    const z = await prisma.analystZone.findFirstOrThrow({ where: { planId: p.id, kind: "SELL" } });
    expect(z).toMatchObject({ state: "ENTERED", enteredPrice: 3940 });
  });

  it("posts to the channel only for plans that ask for it, and keeps a failed post on the zone", async () => {
    const posts: string[] = [];
    const channel = { post: async (t: string) => { posts.push(t); return 77; }, reply: async () => 0 };
    const quiet = await goldPlan();
    const loud = await goldPlan({ source: "Loud", postToChannel: true });
    const bars = [{ time: T0, open: 3960, high: 3965, low: 3955, close: 3960 }];
    const r = await evaluateZones({ now: new Date(T0 + M5), barsOf: async () => bars, barsTfOf: async () => [], priceOf: async () => null, telegram: null, channel, channelUsername: "gheymat_today" });
    expect(r.entered).toBe(2);
    expect(posts).toHaveLength(1);
    expect(posts[0]).not.toContain("Loud");
    expect(posts[0]).toContain("@gheymat_today");
    // Sell entered at 3940: stop 13% above, first target 5% below, risk line with its reasons.
    expect(posts[0]).toContain("حد ضرر: 4,452.2 (13%)");
    expect(posts[0]).toContain("حد سود 1: 3,743 (5%) — ریسک‌فری و سیو سود");
    expect(posts[0]).toContain("ریسک: متوسط — خبر مهم نزدیک است: NFP، منبع هنوز آمار کافی ندارد");
    expect((await prisma.analystZone.findFirstOrThrow({ where: { planId: loud.id, kind: "SELL" } })).channelMessageId).toBe(77);
    expect((await prisma.analystZone.findFirstOrThrow({ where: { planId: quiet.id, kind: "SELL" } })).channelMessageId).toBeNull();

    const failing = await goldPlan({ source: "Down", postToChannel: true, zones: [{ symbol: "XAU/USD", kind: "TARGET", low: 3930, high: 3950 }] });
    const bad = { post: async () => { throw new Error("Forbidden: bot is not a member of the channel"); }, reply: async () => 0 };
    const r2 = await evaluateZones({ now: new Date(T0 + 2 * M5), barsOf: async () => bars, barsTfOf: async () => [], priceOf: async () => null, telegram: null, channel: bad, channelUsername: null });
    expect(r2.entered).toBe(1);
    expect((await prisma.analystZone.findFirstOrThrow({ where: { planId: failing.id } })).channelError).toMatch(/not a member/);
  });

  it("breaks an invalidation only on a closed candle of its timeframe", async () => {
    const p = await goldPlan();
    const fourH = [{ time: T0, open: 3990, high: 4010, low: 3985, close: 4005 }]; // 4005 − 20 = 3985 > 3976
    const deps = { barsOf: async () => [], barsTfOf: async () => fourH, priceOf: async () => null, telegram: tg.bot };
    expect((await evaluateZones({ ...deps, now: new Date(T0 + 3 * H) })).broken).toBe(0);
    expect((await evaluateZones({ ...deps, now: new Date(T0 + 4 * H) })).broken).toBe(1);
    expect(tg.sent[0]).toContain("سناریو باطل شد");
    expect(tg.sent[0]).toContain("کلوز: 3,985");
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
    expect(tg.sent[0]).toContain("به تارگت 3,740–3,760 رسید");
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
