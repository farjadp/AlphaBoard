export const PAIRS = [
  { symbol: "BTC/USDT", name: "Bitcoin", price: 67842.50, change: 2.34, volume: "28.4B", type: "crypto" },
  { symbol: "ETH/USDT", name: "Ethereum", price: 3521.80, change: 1.12, volume: "14.2B", type: "crypto" },
  { symbol: "SOL/USDT", name: "Solana", price: 145.20, change: 3.45, volume: "4.2B", type: "crypto" },
  { symbol: "XRP/USDT", name: "XRP", price: 0.62, change: -1.24, volume: "1.8B", type: "crypto" },
  { symbol: "XAU/USD", name: "Gold", price: 2350.40, change: 0.45, volume: "N/A", type: "tradfi", yahooSymbol: "GC=F" },
  { symbol: "SPX", name: "S&P 500", price: 5204.34, change: 0.85, volume: "N/A", type: "tradfi", yahooSymbol: "^GSPC" },
  { symbol: "DJI", name: "Dow Jones", price: 39512.13, change: 0.32, volume: "N/A", type: "tradfi", yahooSymbol: "^DJI" },
  { symbol: "NDX", name: "Nasdaq 100", price: 18234.56, change: 1.20, volume: "N/A", type: "tradfi", yahooSymbol: "^NDX" },
  { symbol: "FTSE", name: "FTSE 100", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^FTSE" },
  { symbol: "DAX", name: "DAX 40", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^GDAXI" },
  { symbol: "N225", name: "Nikkei 225", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^N225" },
  { symbol: "HSI", name: "Hang Seng Index", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^HSI" },
  { symbol: "TSX", name: "S&P/TSX Composite", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^GSPTSE" },
  { symbol: "SHCOMP", name: "Shanghai Composite", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "000001.SS" },
  { symbol: "ESTX50", name: "EURO STOXX 50", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^STOXX50E" },
  { symbol: "CAC40", name: "CAC 40", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^FCHI" },
  { symbol: "BVSP", name: "Bovespa Index", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^BVSP" },
  { symbol: "ASX200", name: "ASX 200", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^AXJO" },
  { symbol: "IPC", name: "IPC Mexico", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^MXX" },
  { symbol: "BVLPG", name: "S&P/BVL Peru General", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^SPBLPGPT" },
  { symbol: "JSE40", name: "FTSE/JSE Top 40", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "J200.L" },
  { symbol: "KOSPI", name: "KOSPI", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^KS11" },
  { symbol: "RUT", name: "Russell 2000", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^RUT" },
  { symbol: "IBEX", name: "IBEX 35", price: 0, change: 0, volume: "N/A", type: "tradfi", yahooSymbol: "^IBEX" },
  { symbol: "WTI", name: "Crude Oil", price: 82.30, change: -0.15, volume: "N/A", type: "tradfi", yahooSymbol: "CL=F" },
];

export function generateCandlestickData(days = 90) {
  const data = [];
  let base = 67000;
  const now = Math.floor(Date.now() / 1000);
  const interval = 3600; // 1h candles

  for (let i = days * 24; i >= 0; i--) {
    const open = base;
    const change = (Math.random() - 0.48) * 800;
    const close = open + change;
    const high = Math.max(open, close) + Math.random() * 400;
    const low = Math.min(open, close) - Math.random() * 400;
    data.push({
      time: (now - i * interval) as unknown as import("lightweight-charts").Time,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
    });
    base = close;
  }
  return data;
}

export function generateVolumeData(candleData: ReturnType<typeof generateCandlestickData>) {
  return candleData.map((c) => ({
    time: c.time,
    value: Math.random() * 5000 + 500,
    color: c.close >= c.open ? "rgba(0,212,160,0.4)" : "rgba(255,71,87,0.4)",
  }));
}

export const STATS = {
  price: "$67,842.50",
  change24h: "+2.34%",
  change24hRaw: 2.34,
  high24h: "$69,120.00",
  low24h: "$65,980.00",
  volume24h: "$28.4B",
  marketCap: "$1.34T",
  dominance: "52.8%",
  fundingRate: "0.0105%",
  openInterest: "$18.2B",
  longShortRatio: "1.42",
};

export const NEWS = [
  {
    id: 1,
    time: "2m ago",
    source: "CoinDesk",
    headline: "Bitcoin breaks resistance at $68K as institutional inflows surge",
    sentiment: "bullish" as const,
    tags: ["BTC", "Institutional"],
  },
  {
    id: 2,
    time: "14m ago",
    source: "The Block",
    headline: "Ethereum layer-2 TVL reaches new all-time high of $52B combined",
    sentiment: "bullish" as const,
    tags: ["ETH", "L2", "DeFi"],
  },
  {
    id: 3,
    time: "32m ago",
    source: "Decrypt",
    headline: "SEC delays decision on spot Ethereum ETF options — sources",
    sentiment: "bearish" as const,
    tags: ["ETH", "Regulation"],
  },
  {
    id: 4,
    time: "1h ago",
    source: "Bloomberg",
    headline: "Fed signals potential rate cuts in Q3, crypto markets rally",
    sentiment: "bullish" as const,
    tags: ["Macro", "BTC"],
  },
  {
    id: 5,
    time: "2h ago",
    source: "CoinTelegraph",
    headline: "Solana network upgrade reduces block time to 400ms",
    sentiment: "bullish" as const,
    tags: ["SOL", "Tech"],
  },
  {
    id: 6,
    time: "3h ago",
    source: "Reuters",
    headline: "Binance reaches settlement in South Korean regulatory probe",
    sentiment: "neutral" as const,
    tags: ["BNB", "Regulation"],
  },
  {
    id: 7,
    time: "4h ago",
    source: "DeFi Pulse",
    headline: "Aave V4 launches with new risk framework and isolated pools",
    sentiment: "bullish" as const,
    tags: ["DeFi", "AAVE"],
  },
];

export const ALERT_CHANNELS = ["Telegram", "Email", "Discord", "Webhook"];

export const ALERT_CONDITIONS = [
  "Price crosses above",
  "Price crosses below",
  "Price change > (24h %)",
  "Volume spike > (x avg)",
  "RSI overbought (> 70)",
  "RSI oversold (< 30)",
  "MACD bullish crossover",
  "MACD bearish crossover",
];

export type Pair = (typeof PAIRS)[0];
export type NewsItem = (typeof NEWS)[0];
