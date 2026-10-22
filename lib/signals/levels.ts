import { ASSET_CATALOG } from "@/lib/assetCatalog";
import type { Candle } from "@/lib/candlestickPatterns";
import { computeAtr, roundForPrice } from "@/lib/market/indicators";
import { num } from "./num";

/**
 * "Suggest stop & targets" for the Signal Desk: when a signal gives only a symbol and a side, read the last two
 * days of 1H candles and place the stop past the swing and four targets on Fibonacci extensions of that swing.
 * Deterministic and explained; it is a starting point the owner edits, not a forecast.
 *
 * Levels are computed as distances on the chart data and placed around the reference price (the typed entry, or
 * the last close). Some feeds are offset from the broker (gold here is COMEX futures, a few dollars above spot),
 * so a typed broker price gives exact levels.
 */
export const LOOKBACK_BARS = 48;
export const FIB_EXTENSIONS = [0.618, 1, 1.272, 1.618] as const;
const STOP_BUFFER_ATR = 0.25;
const MIN_STOP_ATR = 1.5; // the desk's own minimum (P10)
const MAX_STOP_ATR = 3;
const MIN_RANGE_ATR = 2;

export interface SuggestedLevels {
  stop: number;
  tps: number[];
  /** The chart's last close the distances were measured from. */
  price: number;
  basis: { timeframe: "1H"; swingLow: number; swingHigh: number; atr: number };
  notes: string[];
}

export function suggestLevels(bars: Candle[], side: "BUY" | "SELL", reference: number | null): SuggestedLevels {
  const clean = bars.filter((b) => b.high > 0 && b.low > 0 && b.close > 0);
  const atr = computeAtr(clean, 14);
  if (atr == null || clean.length < LOOKBACK_BARS || atr <= 0) throw new Error("not enough recent candles to suggest levels");
  const recent = clean.slice(-LOOKBACK_BARS);
  const price = clean[clean.length - 1].close;
  const swingLow = Math.min(...recent.map((b) => b.low));
  const swingHigh = Math.max(...recent.map((b) => b.high));
  const range = Math.max(swingHigh - swingLow, MIN_RANGE_ATR * atr);
  const dir = side === "BUY" ? 1 : -1;

  const swingStop = side === "BUY" ? swingLow - STOP_BUFFER_ATR * atr : swingHigh + STOP_BUFFER_ATR * atr;
  const rawDist = Math.abs(price - swingStop);
  const dist = Math.min(Math.max(rawDist, MIN_STOP_ATR * atr), MAX_STOP_ATR * atr);
  const ref = reference ?? price;
  const shift = ref - price;
  const round = (v: number) => roundForPrice(v, ref);

  const stop = round(price - dir * dist + shift);
  const tps = FIB_EXTENSIONS.map((f) => round(price + dir * range * f + shift)).filter((t) => t > 0);

  const notes = [
    `Stop ${side === "BUY" ? "below the 2-day swing low" : "above the 2-day swing high"} (${num(round(side === "BUY" ? swingLow : swingHigh))}) with a ${STOP_BUFFER_ATR} ATR buffer${rawDist !== dist ? `, moved to ${rawDist < dist ? MIN_STOP_ATR : MAX_STOP_ATR} ATR` : ""} (1H ATR ${num(round(atr))})`,
    `Targets: Fibonacci extensions ${FIB_EXTENSIONS.join(" / ")} of the 2-day swing (${num(round(swingHigh - swingLow))}${range > swingHigh - swingLow ? `, widened to ${MIN_RANGE_ATR} ATR` : ""}) from ${reference == null ? "the last price" : "your entry"}`,
  ];
  return { stop, tps, price: roundForPrice(price, price), basis: { timeframe: "1H", swingLow, swingHigh, atr }, notes };
}

/** "XAUUSD.ec", "GOLD", "OP", "ETHUSD.ec" → the market-data catalog's symbol ("XAU/USD", "OP/USDT"), or null. */
export function catalogSymbolFor(raw: string): string | null {
  const s = raw.split(".")[0].replace(/[a-z]+$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const want = ({ GOLD: "XAUUSD", SILVER: "XAGUSD" } as Record<string, string>)[s] ?? s;
  if (!want) return null;
  const variants = [want, `${want}USDT`, want.replace(/USD$/, "USDT"), want.replace(/USDT$/, "USD")];
  for (const v of variants) {
    const hit = ASSET_CATALOG.find((a) => a.symbol.replace("/", "").toUpperCase() === v);
    if (hit) return hit.symbol;
  }
  return null;
}
