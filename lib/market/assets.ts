import { findAsset, type Asset } from "@/lib/assetCatalog";
import { badRequest } from "@/lib/http/errors";
import { isTimeframeKey, type TimeframeKey } from "./timeframes";

export function requireAsset(symbol: unknown): Asset {
  const asset = typeof symbol === "string" ? findAsset(symbol) : undefined;
  if (!asset) throw badRequest("Unsupported or missing symbol", "BAD_SYMBOL");
  return asset;
}

export function requireTimeframe(value: unknown, fallback: TimeframeKey): TimeframeKey {
  if (value === null || value === undefined || value === "") return fallback;
  const v = String(value).toUpperCase();
  if (!isTimeframeKey(v)) throw badRequest("Unsupported timeframe", "BAD_TIMEFRAME");
  return v;
}
