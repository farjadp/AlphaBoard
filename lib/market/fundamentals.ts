import { ASSET_CATALOG, type Asset } from "@/lib/assetCatalog";
import { logger } from "@/lib/http/logger";
import { formatMarketCap } from "@/lib/binance";
import { marketMemo } from "./cache";
import { fetchJson } from "./http";

export interface BalanceSheet {
  marketCap: number | null;
  fdv: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null; // null = no hard cap
}

export interface Cashflow {
  fees24h: number | null; fees7d: number | null; fees30d: number | null;
  revenue24h: number | null; revenue7d: number | null; revenue30d: number | null;
}

export interface GlobalMarket {
  btcDominancePct: number | null;
  ethDominancePct: number | null;
  totalMarketCapUsd: number | null;
  totalMarketCapLabel: string | null;
  marketCapChange24hPct: number | null;
}

const fin = (v: unknown) => { const n = Number(v); return v !== null && v !== undefined && Number.isFinite(n) ? n : null; };
const warn = (what: string, e: unknown) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, `${what} unavailable`);

// ─── CoinGecko: one batched call for every coin in the catalog, cached 5 min ─

type CgRow = { id: string; market_cap?: number | null; fully_diluted_valuation?: number | null; circulating_supply?: number | null; total_supply?: number | null; max_supply?: number | null };

function allMarkets() {
  const ids = ASSET_CATALOG.flatMap((a) => (a.coingeckoId ? [a.coingeckoId] : [])).join(",");
  return marketMemo("coingecko:markets", 5 * 60_000, async () => {
    const rows = await fetchJson<CgRow[]>(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&ids=${ids}`);
    if (!Array.isArray(rows)) throw new Error("coingecko: unexpected payload");
    return new Map(rows.map((r) => [r.id, r]));
  });
}

export async function getBalanceSheet(asset: Asset): Promise<BalanceSheet | null> {
  if (!asset.coingeckoId) return null;
  try {
    const row = (await allMarkets()).get(asset.coingeckoId);
    if (!row) return null;
    return {
      marketCap: fin(row.market_cap),
      fdv: fin(row.fully_diluted_valuation),
      circulatingSupply: fin(row.circulating_supply),
      totalSupply: fin(row.total_supply),
      maxSupply: fin(row.max_supply),
    };
  } catch (e) { warn("coingecko markets", e); return null; }
}

// ─── DefiLlama: chain fees & revenue, cached 10 min ──────────────────────────

type LlamaOverview = { protocols?: Array<{ slug?: string; total24h?: number | null; total7d?: number | null; total30d?: number | null }> };

function llama(dataType: "dailyFees" | "dailyRevenue") {
  return marketMemo(`defillama:${dataType}`, 10 * 60_000, async () => {
    const j = await fetchJson<LlamaOverview>(
      `https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=${dataType}`,
      { timeoutMs: 15_000 },
    );
    return new Map((j.protocols ?? []).filter((p) => p.slug).map((p) => [p.slug!, p]));
  });
}

export async function getCashflow(asset: Asset): Promise<Cashflow | null> {
  if (!asset.defillamaSlug) return null;
  try {
    const [fees, rev] = await Promise.all([llama("dailyFees"), llama("dailyRevenue").catch(() => new Map())]);
    const f = fees.get(asset.defillamaSlug);
    const r = rev.get(asset.defillamaSlug);
    if (!f && !r) return null;
    return {
      fees24h: fin(f?.total24h), fees7d: fin(f?.total7d), fees30d: fin(f?.total30d),
      revenue24h: fin(r?.total24h), revenue7d: fin(r?.total7d), revenue30d: fin(r?.total30d),
    };
  } catch (e) { warn("defillama fees", e); return null; }
}

// ─── Global crypto market ────────────────────────────────────────────────────

export async function getGlobalMarket(): Promise<GlobalMarket | null> {
  try {
    return await marketMemo("coingecko:global", 2 * 60_000, async () => {
      type G = { data?: { market_cap_percentage?: Record<string, number>; total_market_cap?: Record<string, number>; market_cap_change_percentage_24h_usd?: number } };
      const { data } = await fetchJson<G>("https://api.coingecko.com/api/v3/global");
      const total = fin(data?.total_market_cap?.usd);
      return {
        btcDominancePct: fin(data?.market_cap_percentage?.btc),
        ethDominancePct: fin(data?.market_cap_percentage?.eth),
        totalMarketCapUsd: total,
        totalMarketCapLabel: total === null ? null : formatMarketCap(total),
        marketCapChange24hPct: fin(data?.market_cap_change_percentage_24h_usd),
      };
    });
  } catch (e) { warn("coingecko global", e); return null; }
}
