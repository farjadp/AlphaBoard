/**
 * Perpetual-futures context (funding, open interest, long/short account ratio).
 * Fetched server-side with a provider chain — Binance → Bybit → OKX — because each one is
 * geo-blocked somewhere (Binance futures is blocked from US cloud regions). v1 called
 * fapi.binance.com from the browser, which failed for many users and violates our CSP.
 */
import type { Asset } from "@/lib/assetCatalog";
import { logger } from "@/lib/http/logger";
import { marketMemo } from "./cache";
import { fetchJson } from "./http";

export type FuturesSource = "binance" | "bybit" | "okx";

export interface FuturesSnapshot {
  source: FuturesSource;
  contract?: string;
  fundingRatePct: number | null;   // per funding interval, in percent (0.01 = 0.01%)
  openInterestUsd: number | null;
  longPct: number | null;          // share of accounts net long, 0–100
  shortPct: number | null;
  longShortRatio: number | null;
  asOf: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function fromRatio(ratio: number | null) {
  if (ratio === null || ratio <= 0) return { longPct: null, shortPct: null, longShortRatio: null };
  const longPct = (ratio / (1 + ratio)) * 100;
  return { longPct, shortPct: 100 - longPct, longShortRatio: ratio };
}

// ─── Parsers (pure, unit-tested) ─────────────────────────────────────────────

type BinancePrem = { markPrice?: string; lastFundingRate?: string; time?: number };
type BinanceOi = { openInterest?: string };
type BinanceLs = Array<{ longAccount?: string; shortAccount?: string; longShortRatio?: string; timestamp?: number }>;

export function parseBinanceFutures(prem: BinancePrem, oi: BinanceOi | null, ls: BinanceLs | null): FuturesSnapshot {
  const mark = num(prem?.markPrice);
  const funding = num(prem?.lastFundingRate);
  if (mark === null || funding === null) throw new Error("binance: missing premium index");
  const contracts = num(oi?.openInterest);
  const row = Array.isArray(ls) ? ls[0] : undefined;
  const longAcc = num(row?.longAccount);
  const shortAcc = num(row?.shortAccount);
  return {
    source: "binance",
    fundingRatePct: funding * 100,
    openInterestUsd: contracts === null ? null : contracts * mark,
    longPct: longAcc === null ? null : longAcc * 100,
    shortPct: shortAcc === null ? null : shortAcc * 100,
    longShortRatio: num(row?.longShortRatio),
    asOf: new Date().toISOString(),
  };
}

type BybitEnvelope<T> = { retCode?: number; result?: { list?: T[] } };

export function parseBybitFutures(
  tickers: BybitEnvelope<{ fundingRate?: string; openInterestValue?: string; markPrice?: string }>,
  ratio: BybitEnvelope<{ buyRatio?: string; sellRatio?: string; timestamp?: string }> | null,
): FuturesSnapshot {
  const t = tickers?.retCode === 0 ? tickers.result?.list?.[0] : undefined;
  if (!t) throw new Error("bybit: no ticker");
  const r = ratio?.retCode === 0 ? ratio.result?.list?.[0] : undefined;
  const buy = num(r?.buyRatio);
  const sell = num(r?.sellRatio);
  return {
    source: "bybit",
    fundingRatePct: num(t.fundingRate) === null ? null : num(t.fundingRate)! * 100,
    openInterestUsd: num(t.openInterestValue),
    longPct: buy === null ? null : buy * 100,
    shortPct: sell === null ? null : sell * 100,
    longShortRatio: buy !== null && sell ? buy / sell : null,
    asOf: new Date().toISOString(),
  };
}

type OkxEnvelope<T> = { code?: string; data?: T[] };

export function parseOkxFutures(
  funding: OkxEnvelope<{ fundingRate?: string }>,
  oi: OkxEnvelope<{ oiUsd?: string }> | null,
  ls: OkxEnvelope<[string, string]> | null,
): FuturesSnapshot {
  const f = funding?.code === "0" ? funding.data?.[0] : undefined;
  if (!f) throw new Error("okx: no funding data");
  const o = oi?.code === "0" ? oi.data?.[0] : undefined;
  const l = ls?.code === "0" ? ls.data?.[0] : undefined;
  const rate = num(f.fundingRate);
  return {
    source: "okx",
    fundingRatePct: rate === null ? null : rate * 100,
    openInterestUsd: num(o?.oiUsd),
    ...fromRatio(num(l?.[1])),
    asOf: new Date().toISOString(),
  };
}

/** Low-priced coins trade as 1000x contracts on Binance/Bybit (1000PEPEUSDT). */
export function futuresSymbolCandidates(binanceSymbol: string): string[] {
  return [binanceSymbol, `1000${binanceSymbol}`];
}

// ─── Providers ───────────────────────────────────────────────────────────────

const optional = <T>(p: Promise<T>) => p.catch(() => null);

async function fromBinance(sym: string) {
  const base = "https://fapi.binance.com";
  const [prem, oi, ls] = await Promise.all([
    fetchJson<BinancePrem>(`${base}/fapi/v1/premiumIndex?symbol=${sym}`),
    optional(fetchJson<BinanceOi>(`${base}/fapi/v1/openInterest?symbol=${sym}`)),
    optional(fetchJson<BinanceLs>(`${base}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=5m&limit=1`)),
  ]);
  return parseBinanceFutures(prem, oi, ls);
}

async function fromBybit(sym: string) {
  const base = "https://api.bybit.com/v5/market";
  const [t, r] = await Promise.all([
    fetchJson<Parameters<typeof parseBybitFutures>[0]>(`${base}/tickers?category=linear&symbol=${sym}`),
    optional(fetchJson<Parameters<typeof parseBybitFutures>[1]>(`${base}/account-ratio?category=linear&symbol=${sym}&period=5min&limit=1`)),
  ]);
  return parseBybitFutures(t, r);
}

async function fromOkx(baseCcy: string) {
  const inst = `${baseCcy}-USDT-SWAP`;
  const base = "https://www.okx.com/api/v5";
  const [f, oi, ls] = await Promise.all([
    fetchJson<Parameters<typeof parseOkxFutures>[0]>(`${base}/public/funding-rate?instId=${inst}`),
    optional(fetchJson<Parameters<typeof parseOkxFutures>[1]>(`${base}/public/open-interest?instType=SWAP&instId=${inst}`)),
    optional(fetchJson<Parameters<typeof parseOkxFutures>[2]>(`${base}/rubik/stat/contracts/long-short-account-ratio?ccy=${baseCcy}&period=5m`)),
  ]);
  return parseOkxFutures(f, oi, ls);
}

/** Returns null for assets without a perpetual market or when every provider fails. */
export async function getFutures(asset: Asset): Promise<FuturesSnapshot | null> {
  if (asset.category !== "crypto" || !asset.binanceSymbol) return null;
  const spot = asset.binanceSymbol;
  const baseCcy = spot.replace(/USDT$/, "");

  return marketMemo(`futures:${spot}`, 60_000, async () => {
    const attempts: Array<[string, () => Promise<FuturesSnapshot>]> = [
      ...futuresSymbolCandidates(spot).map((s) => [`binance:${s}`, () => fromBinance(s)] as [string, () => Promise<FuturesSnapshot>]),
      ...futuresSymbolCandidates(spot).map((s) => [`bybit:${s}`, () => fromBybit(s)] as [string, () => Promise<FuturesSnapshot>]),
      [`okx:${baseCcy}`, () => fromOkx(baseCcy)],
    ];
    const errors: string[] = [];
    for (const [name, run] of attempts) {
      try {
        const snap = await run();
        return { ...snap, contract: name.split(":")[1] };
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    logger.warn({ symbol: spot, errors }, "futures: all providers failed");
    return null;
  });
}
