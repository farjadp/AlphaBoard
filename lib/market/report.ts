import type { Asset } from "@/lib/assetCatalog";
import { logger } from "@/lib/http/logger";
import { marketMemo } from "./cache";
import { getCandles } from "./candles";
import {
  calculateConsensusScore, calculateIndicatorSnapshot, unavailableSnapshot,
  type ConsensusScore, type IndicatorSnapshot,
} from "./indicators";
import { CONSENSUS_TIMEFRAMES, type TimeframeKey } from "./timeframes";

export type TimeframeSummary = Omit<IndicatorSnapshot, "candlestickMatches" | "chartPatternMatches">;

export interface IndicatorReport extends IndicatorSnapshot {
  timeframe: TimeframeKey;
  multiTimeframes: TimeframeSummary[];
  consensusScore: ConsensusScore;
  generatedAt: string;
}

async function snapshot(asset: Asset, key: TimeframeKey): Promise<IndicatorSnapshot> {
  try {
    return calculateIndicatorSnapshot(key, await getCandles(asset, key));
  } catch (e) {
    logger.warn({ symbol: asset.symbol, timeframe: key, err: e instanceof Error ? e.message : String(e) }, "candles unavailable");
    return unavailableSnapshot(key, "Market data provider unavailable for this timeframe");
  }
}

const summarize = ({ candlestickMatches: _c, chartPatternMatches: _p, ...rest }: IndicatorSnapshot): TimeframeSummary => rest;

/** Primary timeframe snapshot + multi-timeframe consensus. Every value is computed server-side. */
export function getIndicatorReport(asset: Asset, key: TimeframeKey): Promise<IndicatorReport> {
  return marketMemo(`report:${asset.symbol}:${key}`, 20_000, async () => {
    const keys = Array.from(new Set<TimeframeKey>([key, ...CONSENSUS_TIMEFRAMES]));
    const snaps = new Map((await Promise.all(keys.map(async (k) => [k, await snapshot(asset, k)] as const))));
    const multi = CONSENSUS_TIMEFRAMES.map((k) => snaps.get(k)!);
    return {
      ...snaps.get(key)!,
      timeframe: key,
      multiTimeframes: multi.map(summarize),
      consensusScore: calculateConsensusScore(multi),
      generatedAt: new Date().toISOString(),
    };
  });
}
