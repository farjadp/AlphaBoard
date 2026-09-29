import "server-only";
import type { ExchangeConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound } from "@/lib/http/errors";
import { encryptSecret, last4, secretsConfigured } from "@/lib/secrets/crypto";
import { exchangeFor, forgetExchange, supportedExchanges } from "@/lib/venues/ccxtClient";
import { venueForConnection } from "@/lib/venues/registry";

/** Exchange trading is on only with LIVE_TRADING_ENABLED=1 and a valid EXCHANGE_KEY_SECRET (spec E6/E7). */
export const exchangeTradingEnabled = () => process.env.LIVE_TRADING_ENABLED === "1" && secretsConfigured();
export const tradingHalted = () => process.env.TRADING_HALT === "1";

export function requireExchangeAccess(user: { role: string }) {
  if (!exchangeTradingEnabled()) throw forbidden("Exchange trading is off on this server (set LIVE_TRADING_ENABLED=1 and EXCHANGE_KEY_SECRET)");
  if (user.role !== "ADMIN") throw forbidden("Only the owner (admin) can connect exchanges");
}

export interface ConnectionDto {
  id: string;
  provider: "ccxt" | "oanda";
  accountId: string | null;
  exchange: string;
  label: string;
  marketType: "spot" | "swap";
  quote: string;
  sandbox: boolean;
  keyLast4: string;
  status: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export const connectionToDto = (c: ExchangeConnection): ConnectionDto => ({
  id: c.id, provider: c.provider === "oanda" ? "oanda" : "ccxt", accountId: c.accountId, exchange: c.exchange, label: c.label, marketType: c.marketType === "swap" ? "swap" : "spot", quote: c.quote, sandbox: c.sandbox,
  keyLast4: c.keyLast4, status: c.status, lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null, lastError: c.lastError, createdAt: c.createdAt.toISOString(),
});

export async function listConnections(userId: string) {
  const rows = await prisma.exchangeConnection.findMany({ where: { userId, status: { not: "DELETED" } }, orderBy: { createdAt: "asc" } });
  return rows.map(connectionToDto);
}

export interface NewConnection {
  provider?: "ccxt" | "oanda";
  /** OANDA v20 account id. */
  accountId?: string;
  exchange: string;
  label?: string;
  marketType: "spot" | "swap";
  quote: string;
  sandbox: boolean;
  apiKey: string;
  secret: string;
  password?: string;
  uid?: string;
}

export async function createConnection(userId: string, i: NewConnection) {
  const oanda = i.provider === "oanda";
  if (oanda) {
    if (!i.accountId?.trim()) throw badRequest("OANDA needs the v20 account id (e.g. 101-001-1234567-001)", "BAD_ACCOUNT");
  } else {
    if (i.secret.trim().length < 4) throw badRequest("The API secret is required", "BAD_SECRET");
    const exchanges = await supportedExchanges();
    if (!exchanges.includes(i.exchange)) throw badRequest(`${i.exchange} is not an exchange ccxt supports`, "BAD_EXCHANGE");
  }
  const row = await prisma.exchangeConnection.create({
    data: {
      userId, provider: oanda ? "oanda" : "ccxt", exchange: oanda ? "oanda" : i.exchange, accountId: oanda ? i.accountId!.trim() : null,
      label: (i.label?.trim() || (oanda ? `OANDA ${i.sandbox ? "practice" : "live"}` : `${i.exchange}${i.sandbox ? " testnet" : ""}`)).slice(0, 60),
      // OANDA positions are margin CFDs: long and short with leverage, like perpetuals.
      marketType: oanda ? "swap" : i.marketType, quote: i.quote.toUpperCase(), sandbox: i.sandbox,
      apiKeyEnc: encryptSecret(i.apiKey.trim()), secretEnc: encryptSecret(i.secret.trim()),
      passwordEnc: i.password?.trim() ? encryptSecret(i.password.trim()) : null,
      uidEnc: i.uid?.trim() ? encryptSecret(i.uid.trim()) : null,
      keyLast4: last4(i.apiKey),
    },
  });
  return connectionToDto(row);
}

async function owned(userId: string, id: string) {
  const c = await prisma.exchangeConnection.findFirst({ where: { id, userId } });
  if (!c) throw notFound("Connection not found");
  return c;
}

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).replace(/\s+/g, " ").slice(0, 300);

/**
 * Check the keys: markets load, the balance is readable, and the quote currency is listed.
 * Stores OK / ERROR with the reason; the key itself never appears in the message.
 */
export async function testConnection(userId: string, id: string) {
  const c = await owned(userId, id);
  forgetExchange(c.id);
  let status = "OK";
  let lastError: string | null = null;
  let balance: number | null = null;
  try {
    if (c.provider === "oanda") {
      const b = await (await venueForConnection(c)).balance();
      balance = b?.free ?? 0;
    } else {
      const ex = await exchangeFor(c);
      const markets = await ex.loadMarkets(true);
      if (!Object.values(markets).some((m) => m.quote === c.quote)) throw new Error(`no ${c.marketType} markets quoted in ${c.quote}`);
      const b = await ex.fetchBalance();
      balance = b.free?.[c.quote] ?? 0;
    }
  } catch (e) {
    status = "ERROR";
    lastError = errText(e);
  }
  const row = await prisma.exchangeConnection.update({ where: { id: c.id }, data: { status, lastError, lastCheckedAt: new Date() } });
  return { connection: connectionToDto(row), freeQuote: balance };
}

export async function deleteConnection(userId: string, id: string) {
  const c = await owned(userId, id);
  const inUse = await prisma.tradingSession.count({ where: { connectionId: c.id, OR: [{ status: { in: ["RUNNING", "PAUSED", "AWAITING_EXTENSION", "ENDING"] } }, { positions: { some: { closedAt: null } } }] } });
  if (inUse) throw badRequest("A session using this connection is still active or has open positions", "IN_USE");
  const used = await prisma.tradingSession.count({ where: { connectionId: c.id } });
  forgetExchange(c.id);
  if (used) {
    // Past sessions keep their history; the keys are wiped.
    await prisma.exchangeConnection.update({ where: { id: c.id }, data: { apiKeyEnc: "", secretEnc: "", passwordEnc: null, uidEnc: null, status: "DELETED", label: `${c.label} (deleted)` } });
  } else {
    await prisma.exchangeConnection.delete({ where: { id: c.id } });
  }
}
