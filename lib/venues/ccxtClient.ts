import "server-only";
import type { ExchangeConnection } from "@prisma/client";
import { decryptSecret } from "@/lib/secrets/crypto";

/** The slice of a ccxt exchange this app uses (lets tests inject a fake). */
export interface CcxtOrder {
  id: string;
  clientOrderId?: string;
  symbol: string;
  status?: string;
  side?: string;
  amount?: number;
  filled?: number;
  remaining?: number;
  average?: number;
  price?: number;
  cost?: number;
  fee?: { cost?: number; currency?: string } | null;
  fees?: Array<{ cost?: number; currency?: string }>;
  timestamp?: number;
}

export interface CcxtMarket {
  symbol: string;
  base: string;
  quote: string;
  active?: boolean;
  type?: string;
  taker?: number;
  contractSize?: number;
  limits: { amount?: { min?: number }; cost?: { min?: number } };
  precision: { amount?: number };
}

export interface ExchangeLike {
  id: string;
  has: Record<string, unknown>;
  markets?: Record<string, CcxtMarket>;
  loadMarkets(reload?: boolean): Promise<Record<string, CcxtMarket>>;
  fetchTicker(symbol: string): Promise<{ last?: number; bid?: number; ask?: number }>;
  fetchBalance(params?: Record<string, unknown>): Promise<{ free?: Record<string, number>; used?: Record<string, number>; total?: Record<string, number> }>;
  createOrder(symbol: string, type: string, side: string, amount: number, price?: number, params?: Record<string, unknown>): Promise<CcxtOrder>;
  fetchOrder(id: string, symbol?: string, params?: Record<string, unknown>): Promise<CcxtOrder>;
  fetchOpenOrders(symbol?: string, since?: number, limit?: number): Promise<CcxtOrder[]>;
  fetchClosedOrders?(symbol?: string, since?: number, limit?: number): Promise<CcxtOrder[]>;
  fetchOrders?(symbol?: string, since?: number, limit?: number): Promise<CcxtOrder[]>;
  cancelOrder(id: string, symbol?: string): Promise<unknown>;
  setLeverage?(leverage: number, symbol?: string, params?: Record<string, unknown>): Promise<unknown>;
  setMarginMode?(mode: string, symbol?: string, params?: Record<string, unknown>): Promise<unknown>;
  fetchPositions?(symbols?: string[]): Promise<Array<{ symbol: string; contracts?: number; side?: string; contractSize?: number }>>;
  amountToPrecision(symbol: string, amount: number): string;
}

type Conn = Pick<ExchangeConnection, "id" | "exchange" | "marketType" | "sandbox" | "apiKeyEnc" | "secretEnc" | "passwordEnc" | "uidEnc" | "keyVersion">;
export type ExchangeFactory = (c: Conn) => Promise<ExchangeLike>;

async function ccxtFactory(c: Conn): Promise<ExchangeLike> {
  const ccxt = (await import("ccxt")).default as unknown as Record<string, new (o: Record<string, unknown>) => ExchangeLike & { setSandboxMode(on: boolean): void }>;
  const Klass = ccxt[c.exchange];
  if (typeof Klass !== "function") throw new Error(`Unsupported exchange: ${c.exchange}`);
  const ex = new Klass({
    apiKey: decryptSecret(c.apiKeyEnc),
    secret: decryptSecret(c.secretEnc),
    ...(c.passwordEnc ? { password: decryptSecret(c.passwordEnc) } : {}),
    ...(c.uidEnc ? { uid: decryptSecret(c.uidEnc) } : {}),
    enableRateLimit: true,
    timeout: 15_000,
    options: { adjustForTimeDifference: true, recvWindow: 5_000, defaultType: c.marketType === "swap" ? "swap" : "spot" },
  });
  // Must happen before any other call (ccxt manual).
  if (c.sandbox) ex.setSandboxMode(true);
  return ex;
}

let factory: ExchangeFactory = ccxtFactory;
const cache = new Map<string, Promise<ExchangeLike>>();

/** One cached instance per connection and key version (ccxt keeps nonce/rate-limit state per instance). */
export function exchangeFor(c: Conn): Promise<ExchangeLike> {
  const key = `${c.id}:${c.keyVersion}`;
  let p = cache.get(key);
  if (!p) {
    p = factory(c).catch((e) => { cache.delete(key); throw e; });
    cache.set(key, p);
  }
  return p;
}

export function forgetExchange(connectionId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${connectionId}:`)) cache.delete(k);
}

/** Tests only. */
export function setExchangeFactory(f: ExchangeFactory | null) {
  factory = f ?? ccxtFactory;
  cache.clear();
}

/** Catalog symbol → exchange symbol: BTC/USDT → BTC/<quote> (spot) or BTC/<quote>:<quote> (swap). */
export function exchangeSymbol(catalogSymbol: string, quote: string, marketType: string): string {
  const base = catalogSymbol.split("/")[0];
  return marketType === "swap" ? `${base}/${quote}:${quote}` : `${base}/${quote}`;
}

export async function supportedExchanges(): Promise<string[]> {
  const ccxt = (await import("ccxt")).default as unknown as { exchanges: string[] };
  return ccxt.exchanges;
}
