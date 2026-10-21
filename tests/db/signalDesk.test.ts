/** Signal Desk against Postgres (P12): device tokens, the EA claim, reports → legs and channel replies. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createDevice, deviceFromRequest, recordHeartbeat, revokeDevice } from "@/lib/mt5/devices";
import { claimJobs, recordReport } from "@/lib/signals/service";
import type { Channel } from "@/lib/signals/channel";

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
  beforeEach(async () => { await prisma.tradeSignal.deleteMany({}); await prisma.mt5Device.deleteMany({}); });
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
});
