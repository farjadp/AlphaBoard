/**
 * Opt-in: real orders on the Binance Spot Testnet (virtual funds).
 *   CCXT_TESTNET_KEY=… CCXT_TESTNET_SECRET=… npm run test:db -- tests/db/binanceTestnet.test.ts
 * Keys come from https://testnet.binance.vision (GitHub login → Generate HMAC key).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secrets/crypto";
import { parseMandate } from "@/lib/sessions/mandate";
import { ccxtVenue } from "@/lib/venues/ccxt";
import { setExchangeFactory } from "@/lib/venues/ccxtClient";
import { reconcileSession } from "@/lib/exec/reconciler";

const key = process.env.CCXT_TESTNET_KEY;
const secret = process.env.CCXT_TESTNET_SECRET;
const run = !!process.env.TEST_DATABASE_URL && !!key && !!secret;
if (run && !process.env.EXCHANGE_KEY_SECRET) process.env.EXCHANGE_KEY_SECRET = randomBytes(32).toString("base64");

describe.skipIf(!run)("Binance Spot Testnet (real API, virtual funds)", () => {
  let session: Awaited<ReturnType<typeof prisma.tradingSession.create>>;
  let conn: Awaited<ReturnType<typeof prisma.exchangeConnection.create>>;

  beforeAll(async () => {
    setExchangeFactory(null);
    const user = await prisma.user.upsert({ where: { email: "testnet@test.local" }, create: { email: "testnet@test.local", passwordHash: "x", role: "ADMIN" }, update: {} });
    conn = await prisma.exchangeConnection.create({
      data: { userId: user.id, exchange: "binance", label: "testnet", sandbox: true, apiKeyEnc: encryptSecret(key!), secretEnc: encryptSecret(secret!), keyLast4: key!.slice(-4), status: "OK" },
    });
    const mandate = parseMandate({ venue: "exchange", connectionId: conn.id, symbols: ["BTC/USDT"], capital: 100 });
    session = await prisma.tradingSession.create({ data: { userId: user.id, name: "testnet", mandate, capital: 100, venue: "exchange", connectionId: conn.id, endsAt: new Date(Date.now() + 3_600_000) } });
  });
  afterAll(async () => {
    await prisma.tradingSession.deleteMany({ where: { id: session?.id } });
    await prisma.exchangeConnection.deleteMany({ where: { id: conn?.id } });
    await prisma.$disconnect();
  });

  it("buys, reconciles and sells a small BTC position", async () => {
    const venue = ccxtVenue(conn);
    const rules = await venue.marketRules("BTC/USDT");
    expect(rules?.price).toBeGreaterThan(0);
    const qty = Math.max(rules!.minQty, 12 / rules!.price); // ≈ $12, above the $5 minimum
    const open = await venue.openPosition({ sessionId: session.id, clientOrderId: `ab-it-${Date.now()}`, symbol: "BTC/USDT", side: "LONG", qty, leverage: 1, stopLoss: rules!.price * 0.9, takeProfit: null, exitPlan: {} });
    expect(open.fill.qty).toBeGreaterThan(0);
    expect((await reconcileSession(session)).issues).toEqual([]);
    const close = await venue.closePosition({ sessionId: session.id, clientOrderId: `ab-it-x-${Date.now()}`, positionId: open.positionId, reason: "MANUAL" });
    expect(close?.closed).toBe(true);
  }, 60_000);
});
