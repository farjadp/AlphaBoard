/** 24h ticker as the Binance hooks deliver it. */
export interface BinanceTicker {
  symbol: string;   // "BTCUSDT"
  price: number;
  change: number;   // 24h change %
  high: number;
  low: number;
  volume: number;   // quote volume in USDT
}
