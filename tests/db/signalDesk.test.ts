/** Signal Desk against Postgres (P12): device tokens, the EA claim, reports → legs and channel replies. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { createDevice, deviceFromRequest, recordHeartbeat, revokeDevice } from "@/lib/signalDesk/devices";
import { claimJobs, createSignal, queueCommand, recordReport, sweepSignals } from "@/lib/signalDesk/service";
import type { Telegram } from "@/lib/notify/telegram";
import { getPostTemplate, resetPostTemplate, savePostTemplate } from "@/lib/signalDesk/template";
import type { Channel } from "@/lib/signalDesk/channel";

const run = !!process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-21T15:00:00Z");
const req = (token?: string) => new Request("http://x/api/mt5/signals/next", { headers: token ? { authorization: `Bearer ${token}` } : {} });

function fakeChannel() {
  const sent: Array<{ replyTo: number | null; text: string }> = [];
  const ch: Channel = {
    post: async (text) => { sent.push({ replyTo: null, text }); return 100 + sent.length; },
    reply: async (id, text) => { sent.push({ replyTo: id, text }); return 100 + sent.length; },
  };
  return { ch, sent };
}

describe.skipIf(!run)("Signal Desk (Postgres)", () => {
  let A: string, B: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "sig-a@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "sig-b@test.local", passwordHash: "x" } })).id;
  });
  beforeEach(async () => { await prisma.tradeSignal.deleteMany({}); await prisma.mt5Device.deleteMany({}); await prisma.notification.deleteMany({}); });
  afterAll(async () => { await prisma.$disconnect(); });

  const signal = (userId: string, over: Record<string, unknown> = {}) => prisma.tradeSignal.create({
    data: { userId, symbol: "XAUUSD.ec", side: "BUY", entry: 2650, stop: 2638, tps: [2656, 2662], riskPct: 0.5, execute: true, post: true,
      expiresAt: new Date(NOW.getTime() + 10 * 60_000), channelMessageId: 77, ...over },
  });

  describe("devices", () => {
    it("authenticates by token and never stores it in clear", async () => {
      const { device, token } = await createDevice(A, "Mac terminal");
      expect(device.tokenHash).not.toBe(token);
      expect(device.last4).toBe(token.slice(-4));
      const d = await deviceFromRequest(req(token), NOW);
      expect(d.id).toBe(device.id);
      expect((await prisma.mt5Device.findUniqueOrThrow({ where: { id: device.id } })).lastSeenAt).toEqual(NOW);
    });
    it("rejects a missing, wrong or revoked token with 401", async () => {
      const { device, token } = await createDevice(A, "t");
      for (const r of [req(), req("nope"), req(`${token}x`)]) await expect(deviceFromRequest(r)).rejects.toMatchObject({ status: 401 });
      await expect(revokeDevice(B, device.id)).rejects.toMatchObject({ status: 404 });
      await revokeDevice(A, device.id);
      await expect(deviceFromRequest(req(token))).rejects.toMatchObject({ status: 401 });
    });
    it("stores the heartbeat and drops junk symbols", async () => {
      const { device } = await createDevice(A, "t");
      await recordHeartbeat(device, new URLSearchParams("login=22215882&server=ePlanet-Demo&mode=DEMO&balance=1000.5&currency=USD&symbols=XAUUSD.ec,SOLUSD.ec,bad|sym,,US30"));
      expect(await prisma.mt5Device.findUniqueOrThrow({ where: { id: device.id } })).toMatchObject({
        login: "22215882", server: "ePlanet-Demo", tradeMode: "DEMO", balance: 1000.5, currency: "USD", symbols: ["XAUUSD.ec", "SOLUSD.ec", "US30"],
      });
      await expect(recordHeartbeat(device, new URLSearchParams("login=1&mode=LIVE&balance=1&currency=USD&symbols="))).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("claimJobs", () => {
    it("claims a pending signal once and marks it SENT", async () => {
      const { device } = await createDevice(A, "t");
      const s = await signal(A);
      expect(await claimJobs(device, NOW)).toEqual([{ kind: "OPEN", id: s.id, symbol: "XAUUSD.ec", side: "BUY", entry: 2650, stop: 2638, maxDeviation: null, riskPct: 0.5, tps: [2656, 2662] }]);
      expect(await prisma.tradeSignal.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "SENT", sentAt: NOW, deviceId: device.id });
      expect(await claimJobs(device, NOW)).toEqual([]);
    });
    it("gives a job to exactly one of two concurrent polls", async () => {
      const a = (await createDevice(A, "a")).device, b = (await createDevice(A, "b")).device;
      await signal(A);
      const [x, y] = await Promise.all([claimJobs(a, NOW), claimJobs(b, NOW)]);
      expect(x.length + y.length).toBe(1);
    });
    it("never claims expired, channel-only or another user's signals", async () => {
      const { device } = await createDevice(A, "t");
      await signal(A, { expiresAt: new Date(NOW.getTime() - 1) });
      await signal(A, { execute: false, status: "CLOSED" });
      await signal(A, { execute: false });
      await signal(B);
      expect(await claimJobs(device, NOW)).toEqual([]);
    });
    it("returns a queued command once, only to the device that holds the signal", async () => {
      const { device } = await createDevice(A, "t");
      const other = (await createDevice(A, "o")).device;
      const s = await signal(A, { status: "OPEN", deviceId: device.id, pendingCommand: "BREAKEVEN" });
      expect(await claimJobs(other, NOW)).toEqual([]);
      expect(await claimJobs(device, NOW)).toEqual([{ kind: "CMD", id: s.id, command: "BREAKEVEN" }]);
      expect(await claimJobs(device, NOW)).toEqual([]);
    });
  });

  describe("recordReport", () => {
    async function sent() {
      const { device } = await createDevice(A, "t");
      const s = await signal(A, { status: "SENT", deviceId: device.id, sentAt: NOW });
      return { device, s };
    }
    it("only the device that claimed the signal may report on it", async () => {
      const { s } = await sent();
      const other = (await createDevice(A, "o")).device;
      const stranger = (await createDevice(B, "b")).device;
      for (const d of [other, stranger]) await expect(recordReport(d, s.id, { event: "BE", price: 1 })).rejects.toMatchObject({ status: 404 });
    });
    it("FILLED creates legs, TP updates one and replies under the post, repeats do nothing", async () => {
      const { device, s } = await sent();
      const { ch, sent: out } = fakeChannel();
      const deps = { channel: ch, now: NOW };
      await recordReport(device, s.id, { event: "FILLED", leg: 1, ticket: "11", volume: 0.01, price: 2650, tp: 2656 }, deps);
      await recordReport(device, s.id, { event: "FILLED", leg: 2, ticket: "12", volume: 0.01, price: 2650, tp: 2662 }, deps);
      await recordReport(device, s.id, { event: "FILLED", leg: 2, ticket: "12", volume: 0.01, price: 2650, tp: 2662 }, deps);
      expect(await prisma.tradeSignalLeg.count({ where: { signalId: s.id } })).toBe(2);
      expect((await prisma.tradeSignal.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("OPEN");

      await recordReport(device, s.id, { event: "TP", leg: 1, price: 2656 }, deps);
      await recordReport(device, s.id, { event: "TP", leg: 1, price: 2656 }, deps);
      expect(await prisma.tradeSignalLeg.findFirstOrThrow({ where: { signalId: s.id, leg: 1 } })).toMatchObject({ status: "TP", closePrice: 2656, r: 0.5, closedAt: NOW });
      expect(out).toEqual([{ replyTo: 77, text: "🎯 TP1 reached 2656 (+0.5R)" }]);

      await recordReport(device, s.id, { event: "BE", price: 2650 }, deps);
      await recordReport(device, s.id, { event: "BE", price: 2650 }, deps);
      await recordReport(device, s.id, { event: "SL", leg: 2, price: 2650 }, deps);
      const done = await prisma.tradeSignal.findUniqueOrThrow({ where: { id: s.id } });
      expect(done).toMatchObject({ status: "CLOSED", breakevenAt: NOW });
      expect(out.map((o) => o.text)).toEqual(["🎯 TP1 reached 2656 (+0.5R)", "🔒 Stop moved to entry", "⚖️ Stopped at entry (0R)\nResult +0.25R"]);
    });
    it("a REJECTED is stored with its reason and posts nothing", async () => {
      const { device, s } = await sent();
      const { ch, sent: out } = fakeChannel();
      await recordReport(device, s.id, { event: "REJECTED", reason: "price moved" }, { channel: ch, now: NOW });
      expect(await prisma.tradeSignal.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "REJECTED", statusReason: "price moved" });
      expect(out).toEqual([]);
    });
    it("a failing channel does not lose the report; the error is stored", async () => {
      const { device, s } = await sent();
      const ch: Channel = { post: async () => 1, reply: async () => { throw new Error("telegram sendMessage: Forbidden"); } };
      await recordReport(device, s.id, { event: "FILLED", leg: 1, ticket: "11", volume: 0.01, price: 2650, tp: 2656 }, { channel: ch, now: NOW });
      await recordReport(device, s.id, { event: "TP", leg: 1, price: 2656 }, { channel: ch, now: NOW });
      expect(await prisma.tradeSignal.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "CLOSED", channelError: "telegram sendMessage: Forbidden" });
    });
    it("a signal that is not posted gets no replies", async () => {
      const { device } = await createDevice(A, "t");
      const s = await signal(A, { status: "SENT", deviceId: device.id, post: false, channelMessageId: null });
      const { ch, sent: out } = fakeChannel();
      await recordReport(device, s.id, { event: "FILLED", leg: 1, ticket: "11", volume: 0.01, price: 2650, tp: 2656 }, { channel: ch, now: NOW });
      await recordReport(device, s.id, { event: "TP", leg: 1, price: 2656 }, { channel: ch, now: NOW });
      expect(out).toEqual([]);
    });
  });

  describe("createSignal", () => {
    const input = { symbol: "XAUUSD.ec", side: "BUY", entry: 2650.4, stop: 2638, tps: [2656, 2662], execute: true, post: true };
    async function online(userId = A) {
      const { device } = await createDevice(userId, "t");
      await recordHeartbeat(device, new URLSearchParams("login=1&mode=DEMO&balance=1000&currency=USD&symbols=XAUUSD.ec,US30"));
      await prisma.mt5Device.update({ where: { id: device.id }, data: { lastSeenAt: NOW } });
      return device;
    }

    it("stores a pending signal, posts it once and keeps the message id", async () => {
      await online();
      const { ch, sent: out } = fakeChannel();
      const { signal, warnings } = await createSignal(A, input, { channel: ch, now: NOW });
      expect(warnings).toEqual([]);
      expect(signal).toMatchObject({ status: "PENDING", riskPct: 0.5, channelMessageId: 101, expiresAt: new Date(NOW.getTime() + 10 * 60_000) });
      expect(out).toHaveLength(1);
      expect(out[0].text).toMatch(/^XAUUSD\n🟢 Long Position\n\nEntry: 2650.4/);
    });
    it("posts with the saved template, and falls back to the default after a reset", async () => {
      await online();
      await savePostTemplate("{sideEmoji} {symbol} @ {entry}\nSL {stop}\n{targets}");
      const { ch, sent: out } = fakeChannel();
      await createSignal(A, input, { channel: ch, now: NOW });
      expect(out[0].text).toBe("🟢 XAUUSD @ 2650.4\nSL 2638\n🎯 TP1: 2656\n🎯 TP2: 2662");
      await expect(savePostTemplate("{symbol}")).rejects.toMatchObject({ status: 400 });
      await resetPostTemplate();
      expect((await getPostTemplate()).isDefault).toBe(true);
    });
    it("rejects an invalid signal with every reason and stores nothing", async () => {
      await online();
      await expect(createSignal(A, { ...input, stop: 2660, symbol: "BTCUSD.ec" }, { channel: null, now: NOW }))
        .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/BTCUSD.ec is not in the terminal's symbol list; stop must be below entry/) });
      await expect(createSignal(A, { ...input, riskPct: 2 }, { channel: null, now: NOW })).rejects.toMatchObject({ status: 400 });
      expect(await prisma.tradeSignal.count()).toBe(0);
    });
    it("uses another user's terminal for nothing", async () => {
      await online(B);
      await expect(createSignal(A, input, { channel: null, now: NOW })).rejects.toMatchObject({ status: 400 });
    });
    it("keeps the signal when the channel fails, and says so", async () => {
      await online();
      const ch: Channel = { post: async () => { throw new Error("telegram sendMessage: chat not found"); }, reply: async () => 1 };
      const { signal } = await createSignal(A, input, { channel: ch, now: NOW });
      expect(signal).toMatchObject({ status: "PENDING", channelMessageId: null, channelError: "telegram sendMessage: chat not found" });
    });
    it("flags a missing channel config when posting was asked for", async () => {
      await online();
      expect((await createSignal(A, input, { channel: null, now: NOW })).signal.channelError).toBe("channel not configured (SIGNAL_BOT_TOKEN / SIGNAL_CHANNEL_ID)");
    });
    it("a channel-only signal is never executable and does not post when post is off", async () => {
      const { ch, sent: out } = fakeChannel();
      const { signal } = await createSignal(A, { ...input, symbol: "BTCUSD", execute: false }, { channel: ch, now: NOW });
      expect(signal).toMatchObject({ status: "CLOSED", statusReason: "channel only" });
      await online();
      await createSignal(A, { ...input, post: false }, { channel: ch, now: NOW });
      expect(out).toHaveLength(1);
    });
    it("a channel-only market signal takes the live price as its entry", async () => {
      const priceOf = async (sym: string) => (sym === "OP" ? { price: 0.11973, futures: false } : null);
      const { signal } = await createSignal(A, { symbol: "OP", side: "BUY", entry: null, stop: 0.1173, tps: [0.129], execute: false, post: true }, { channel: null, now: NOW, priceOf });
      expect(signal).toMatchObject({ entry: 0.11973, status: "CLOSED", statusReason: "channel only" });
    });
    it("refuses a market entry it cannot price honestly", async () => {
      const base = { side: "BUY", entry: null, stop: 50, tps: [60], execute: false, post: true };
      const priceOf = async (sym: string) => (sym === "XAGUSD" ? { price: 55, futures: true } : null);
      await expect(createSignal(A, { ...base, symbol: "XAGUSD" }, { channel: null, now: NOW, priceOf })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/futures.*type your broker's price/) });
      await expect(createSignal(A, { ...base, symbol: "ZZZ" }, { channel: null, now: NOW, priceOf })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/No live price for ZZZ/) });
    });
    it("checks the stop against the live price it filled in", async () => {
      const priceOf = async () => ({ price: 0.1197, futures: false });
      await expect(createSignal(A, { symbol: "OP", side: "BUY", entry: null, stop: 0.125, tps: [0.13], execute: false, post: true }, { channel: null, now: NOW, priceOf }))
        .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/stop must be below entry/) });
    });
    it("warns when the terminal has not been seen for a minute", async () => {
      const d = await online();
      await prisma.mt5Device.update({ where: { id: d.id }, data: { lastSeenAt: new Date(NOW.getTime() - 61_000) } });
      const { warnings } = await createSignal(A, input, { channel: null, now: NOW });
      expect(warnings).toEqual(["terminal offline; the signal expires at 15:10 UTC unless it comes back"]);
    });
  });

  describe("queueCommand", () => {
    it("cancels a pending signal, but not one already sent", async () => {
      const p = await signal(A);
      await queueCommand(A, p.id, { command: "CANCEL" });
      expect((await prisma.tradeSignal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("CANCELLED");
      const s = await signal(A, { status: "SENT" });
      await expect(queueCommand(A, s.id, { command: "CANCEL" })).rejects.toMatchObject({ status: 409, message: "already sent to the terminal; use Close all" });
    });
    it("queues BREAKEVEN / CLOSE_ALL only on an open signal of the owner", async () => {
      const o = await signal(A, { status: "OPEN" });
      await queueCommand(A, o.id, { command: "CLOSE_ALL" });
      expect((await prisma.tradeSignal.findUniqueOrThrow({ where: { id: o.id } })).pendingCommand).toBe("CLOSE_ALL");
      const p = await signal(A);
      await expect(queueCommand(A, p.id, { command: "BREAKEVEN" })).rejects.toMatchObject({ status: 409 });
      await expect(queueCommand(B, o.id, { command: "BREAKEVEN" })).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("management commands (P14d)", () => {
    it("MOVE_SL only tightens and stays short of every open target; one command waits at a time", async () => {
      const o = await signal(A, { status: "OPEN", side: "BUY", stop: 2600 });
      await prisma.tradeSignalLeg.create({ data: { signalId: o.id, leg: 1, ticket: "1", volume: 0.1, openPrice: 2650, tp: 2680 } });
      await expect(queueCommand(A, o.id, { command: "MOVE_SL", price: 2590 })).rejects.toMatchObject({ status: 400 });
      await expect(queueCommand(A, o.id, { command: "MOVE_SL", price: 2690 })).rejects.toMatchObject({ status: 400 });
      await queueCommand(A, o.id, { command: "MOVE_SL", price: 2640 });
      expect((await prisma.tradeSignal.findUniqueOrThrow({ where: { id: o.id } })).pendingCommand).toBe("MOVE_SL|2640");
      await expect(queueCommand(A, o.id, { command: "CLOSE_ALL" })).rejects.toMatchObject({ status: 409 });
    });
    it("MOVE_TP needs an open leg and a level beyond its entry; CLOSE_PARTIAL encodes the fraction", async () => {
      const o = await signal(A, { status: "OPEN", side: "SELL", stop: 2700 });
      await prisma.tradeSignalLeg.create({ data: { signalId: o.id, leg: 2, ticket: "2", volume: 0.1, openPrice: 2650, tp: 2600 } });
      await expect(queueCommand(A, o.id, { command: "MOVE_TP", leg: 1, price: 2600 })).rejects.toMatchObject({ status: 400 });
      await expect(queueCommand(A, o.id, { command: "MOVE_TP", leg: 2, price: 2660 })).rejects.toMatchObject({ status: 400 });
      await queueCommand(A, o.id, { command: "MOVE_TP", leg: 2, price: 2590 });
      expect((await prisma.tradeSignal.findUniqueOrThrow({ where: { id: o.id } })).pendingCommand).toBe("MOVE_TP|2|2590");
      const q = await signal(A, { status: "OPEN" });
      await queueCommand(A, q.id, { command: "CLOSE_PARTIAL", fraction: 0.5 });
      expect((await prisma.tradeSignal.findUniqueOrThrow({ where: { id: q.id } })).pendingCommand).toBe("CLOSE_PARTIAL|0.5");
    });
  });

  describe("sweepSignals", () => {
    it("expires stale pending signals and flags silent sent ones once, with one alert", async () => {
      const chat = "555";
      await prisma.user.update({ where: { id: A }, data: { telegramChatId: chat } });
      const msgs: string[] = [];
      const tg: Telegram = { username: async () => "bot", updates: async () => [], send: async (_c, t) => { msgs.push(t); return 1; } };
      const old = await signal(A, { expiresAt: new Date(NOW.getTime() - 1) });
      const fresh = await signal(A);
      const silent = await signal(A, { status: "SENT", sentAt: new Date(NOW.getTime() - 121_000) });
      const recent = await signal(A, { status: "SENT", sentAt: new Date(NOW.getTime() - 60_000) });

      expect(await sweepSignals(NOW, { telegram: tg })).toEqual({ expired: 1, unknown: 1 });
      const st = async (id: string) => (await prisma.tradeSignal.findUniqueOrThrow({ where: { id } })).status;
      expect([await st(old.id), await st(fresh.id), await st(silent.id), await st(recent.id)]).toEqual(["EXPIRED", "PENDING", "UNKNOWN", "SENT"]);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatch(/XAUUSD/);
      expect(await sweepSignals(NOW, { telegram: tg })).toEqual({ expired: 0, unknown: 0 });
      expect(msgs).toHaveLength(1);
      await prisma.user.update({ where: { id: A }, data: { telegramChatId: null } });
    });
  });
});
