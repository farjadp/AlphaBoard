export interface BinanceTicker {
  symbol: string;   // "BTCUSDT"
  price: number;
  change: number;   // 24h change %
  high: number;
  low: number;
  volume: number;   // quote volume in USDT
}

/** @deprecated import from "@/lib/format" (kept until P13c moves the callers). */
export { formatMarketCap, formatPrice, formatSupply, formatVolume } from "@/lib/format/money";
