/** P6 against Postgres: server-side alerts, notifications, Telegram linking/delivery with a fake bot. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { evaluateAlerts } from "@/lib/alerts/job";
import { listNotifications, markNotificationsRead, notify } from "@/lib/notify/notifications";
import { processTelegramUpdates, startTelegramLink, telegramStatus, unlinkTelegram } from "@/lib/notify/telegramLink";
import type { Telegram } from "@/lib/notify/telegram";
import { openPaperPosition } from "@/lib/paper/account";
import { runTick } from "@/lib/jobs/tick";

const run = !!process.env.TEST_DATABASE_URL;

function fakeBot(inbox: Array<{ updateId: number; chatId: string; text: string }> = []) {
  const sent: Array<{ chatId: string; text: string }> = [];
  const offsets: number[] = [];
  let blocked = false;
  const bot: Telegram = {
    username: async () => "AlphaBoardTestBot",
    updates: async (offset) => { offsets.push(offset); return inbox.filter((u) => u.updateId >= offset); },
    send: async (chatId, text) => { if (blocked) throw new Error("telegram sendMessage: Forbidden: bot was blocked by the user"); sent.push({ chatId, text }); },
  };
  return { bot, sent, offsets, inbox, block: () => { blocked = true; } };
}

describe.skipIf(!run)("alerts & notifications (Postgres)", () => {
  let A: string, B: string;
  const T0 = Date.UTC(2026, 8, 1, 12);

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    await prisma.appSetting.deleteMany({ where: { key: "telegram.offset" } });
    A = (await prisma.user.create({ data: { email: "na@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "nb@test.local", passwordHash: "x" } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("fires an alert once on a candle high crossing the level, with the trigger price, and notifies the owner only", async () => {
    const a = await prisma.priceAlert.create({ data: { userId: A, symbol: "BTC/USDT", targetPrice: 100, condition: "above", lastCheckedAt: new Date(T0) } });
    const idle = await prisma.priceAlert.create({ data: { userId: B, symbol: "BTC/USDT", targetPrice: 90, condition: "below", lastCheckedAt: new Date(T0) } });
    const bars = [
      { time: T0 - 300_000, open: 95, high: 130, low: 80, close: 95 },   // before the alert: ignored
      { time: T0, open: 96, high: 99, low: 94, close: 98 },
      { time: T0 + 300_000, open: 98, high: 101, low: 97, close: 99 },  // crosses 100
    ];
    const r = await evaluateAlerts({ now: new Date(T0 + 400_000), barsOf: async () => bars, priceOf: async () => 99, telegram: null });
    expect(r).toMatchObject({ active: 2, fired: 1 });
    expect(await prisma.priceAlert.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ triggered: true, triggerPrice: 100 });
    const idleAfter = await prisma.priceAlert.findUniqueOrThrow({ where: { id: idle.id } });
    expect(idleAfter).toMatchObject({ triggered: false });
    expect(idleAfter.lastCheckedAt.getTime()).toBe(T0 + 300_000);

    const again = await evaluateAlerts({ now: new Date(T0 + 500_000), barsOf: async () => bars, priceOf: async () => 99, telegram: null });
    expect(again.fired).toBe(0);
    const na = await listNotifications(A);
    expect(na.unread).toBe(1);
    expect(na.items[0]).toMatchObject({ type: "price_alert", title: "BTC/USDT crossed above 100" });
    expect((await listNotifications(B)).items).toHaveLength(0);
  });

  it("keeps alerts waiting (never guesses) when market data is unavailable", async () => {
    const a = await prisma.priceAlert.create({ data: { userId: A, symbol: "ETH/USDT", targetPrice: 1, condition: "above" } });
    const r = await evaluateAlerts({ now: new Date(), barsOf: async () => { throw new Error("down"); }, priceOf: async () => null, telegram: null });
    expect(r.errors.join()).toMatch(/down/);
    expect(await prisma.priceAlert.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ triggered: false });
  });

  it("mark-read is per user", async () => {
    const [n] = (await listNotifications(A)).items;
    await markNotificationsRead(B, [n.id]);
    expect((await listNotifications(A)).unread).toBe(1);
    expect((await markNotificationsRead(A, "all")).unread).toBe(0);
  });

  it("links a chat with /start CODE, rejects bad codes, advances the offset, and /stop unlinks", async () => {
    const f = fakeBot();
    const st = await startTelegramLink(A, f.bot);
    expect(st).toMatchObject({ configured: true, linked: false, botUsername: "AlphaBoardTestBot" });
    expect(st.pendingCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(st.deepLink).toBe(`https://t.me/AlphaBoardTestBot?start=${st.pendingCode}`);

    f.inbox.push({ updateId: 10, chatId: "555", text: "/start WRONGCODE" }, { updateId: 11, chatId: "777", text: `/start ${st.pendingCode!.toLowerCase()}` });
    expect(await processTelegramUpdates(f.bot)).toEqual({ updates: 2, linked: 1 });
    expect(f.sent.map((s) => s.chatId)).toEqual(["555", "777"]);
    expect(f.sent[0].text).toMatch(/invalid or expired/);
    expect(await telegramStatus(A, f.bot)).toMatchObject({ linked: true, pendingCode: null });

    await processTelegramUpdates(f.bot); // nothing new
    expect(f.offsets.at(-1)).toBe(12);

    f.inbox.push({ updateId: 12, chatId: "777", text: "/stop" });
    await processTelegramUpdates(f.bot);
    expect(await telegramStatus(A, f.bot)).toMatchObject({ linked: false });
  });

  it("delivers notifications to a linked chat; a blocked bot unlinks it without losing the in-app copy", async () => {
    await prisma.user.update({ where: { id: B }, data: { telegramChatId: "888" } });
    const f = fakeBot();
    await notify(B, { type: "price_alert", title: "T", body: "B" }, f.bot);
    expect(f.sent).toEqual([{ chatId: "888", text: "🔔 T\nB" }]);
    f.block();
    await notify(B, { type: "price_alert", title: "T2", body: "B2" }, f.bot);
    expect((await listNotifications(B)).items).toHaveLength(2);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: B } })).toMatchObject({ telegramChatId: null });
    await unlinkTelegram(B);
  });

  it("the tick notifies the owner when a paper position is closed by its stop", async () => {
    const pos = await openPaperPosition(B, { symbol: "BTC/USDT", side: "LONG", margin: 100, leverage: 1, stopLoss: 90 }, async () => 100);
    const t = pos.openedAt.getTime();
    await runTick({
      now: () => new Date(t + 400_000), telegram: null, signalBarsOf: async () => null,
      barsOf: async () => [{ time: t + 300_000, open: 99, high: 99, low: 85, close: 88 }], priceOf: async () => 88,
    });
    const items = (await listNotifications(B)).items;
    expect(items.find((n) => n.type === "paper_close")).toMatchObject({ title: "Paper long BTC/USDT closed by stop-loss" });
    // The same tick also fired B's still-active "below 90" alert from the first test.
    expect(items.find((n) => n.title === "BTC/USDT crossed below 90")).toBeTruthy();
  });
});
