export type AssetCategory = "crypto" | "indices" | "commodities" | "forex";

export interface Asset {
  symbol: string;           // Internal symbol: "BTC/USDT", "XAU/USD", "EUR/USD", "SPX"
  name: string;             // Full name: "Bitcoin", "Gold", "Euro / US Dollar"
  category: AssetCategory;
  binanceSymbol?: string;   // e.g. "BTCUSDT" — only for crypto
  yahooSymbol?: string;     // e.g. "GC=F"   — for tradfi
  newsKeyword: string;      // Used to search news API
  icon: string;             // Emoji icon
}

export const ASSET_CATALOG: Asset[] = [
  // ─── Crypto ───────────────────────────────────────────────
  { symbol: "BTC/USDT",  name: "Bitcoin",          category: "crypto",      binanceSymbol: "BTCUSDT",  newsKeyword: "Bitcoin",        icon: "₿" },
  { symbol: "ETH/USDT",  name: "Ethereum",         category: "crypto",      binanceSymbol: "ETHUSDT",  newsKeyword: "Ethereum",       icon: "Ξ" },
  { symbol: "BNB/USDT",  name: "BNB",              category: "crypto",      binanceSymbol: "BNBUSDT",  newsKeyword: "BNB Binance",    icon: "⬡" },
  { symbol: "SOL/USDT",  name: "Solana",           category: "crypto",      binanceSymbol: "SOLUSDT",  newsKeyword: "Solana SOL",     icon: "◎" },
  { symbol: "XRP/USDT",  name: "XRP",              category: "crypto",      binanceSymbol: "XRPUSDT",  newsKeyword: "XRP Ripple",     icon: "✕" },
  { symbol: "ADA/USDT",  name: "Cardano",          category: "crypto",      binanceSymbol: "ADAUSDT",  newsKeyword: "Cardano ADA",    icon: "₳" },
  { symbol: "AVAX/USDT", name: "Avalanche",        category: "crypto",      binanceSymbol: "AVAXUSDT", newsKeyword: "Avalanche AVAX", icon: "🔺" },
  { symbol: "DOGE/USDT", name: "Dogecoin",         category: "crypto",      binanceSymbol: "DOGEUSDT", newsKeyword: "Dogecoin DOGE",  icon: "Ð" },
  { symbol: "TRX/USDT",  name: "TRON",             category: "crypto",      binanceSymbol: "TRXUSDT",  newsKeyword: "TRON TRX",       icon: "◈" },
  { symbol: "DOT/USDT",  name: "Polkadot",         category: "crypto",      binanceSymbol: "DOTUSDT",  newsKeyword: "Polkadot DOT",   icon: "●" },
  { symbol: "LINK/USDT", name: "Chainlink",        category: "crypto",      binanceSymbol: "LINKUSDT", newsKeyword: "Chainlink LINK", icon: "⬡" },
  { symbol: "UNI/USDT",  name: "Uniswap",          category: "crypto",      binanceSymbol: "UNIUSDT",  newsKeyword: "Uniswap UNI",    icon: "🦄" },
  { symbol: "LTC/USDT",  name: "Litecoin",         category: "crypto",      binanceSymbol: "LTCUSDT",  newsKeyword: "Litecoin LTC",   icon: "Ł" },
  { symbol: "ATOM/USDT", name: "Cosmos",           category: "crypto",      binanceSymbol: "ATOMUSDT", newsKeyword: "Cosmos ATOM",    icon: "⚛" },
  { symbol: "NEAR/USDT", name: "NEAR Protocol",    category: "crypto",      binanceSymbol: "NEARUSDT", newsKeyword: "NEAR Protocol",  icon: "Ⓝ" },
  { symbol: "APT/USDT",  name: "Aptos",            category: "crypto",      binanceSymbol: "APTUSDT",  newsKeyword: "Aptos APT",      icon: "◈" },
  { symbol: "OP/USDT",   name: "Optimism",         category: "crypto",      binanceSymbol: "OPUSDT",   newsKeyword: "Optimism OP",    icon: "🔴" },
  { symbol: "ARB/USDT",  name: "Arbitrum",         category: "crypto",      binanceSymbol: "ARBUSDT",  newsKeyword: "Arbitrum ARB",   icon: "🔵" },
  { symbol: "SUI/USDT",  name: "Sui",              category: "crypto",      binanceSymbol: "SUIUSDT",  newsKeyword: "Sui Network",    icon: "💧" },
  { symbol: "TON/USDT",  name: "Toncoin",          category: "crypto",      binanceSymbol: "TONUSDT",  newsKeyword: "Toncoin TON",    icon: "💎" },
  { symbol: "FIL/USDT",  name: "Filecoin",         category: "crypto",      binanceSymbol: "FILUSDT",  newsKeyword: "Filecoin FIL",   icon: "📁" },
  { symbol: "PEPE/USDT", name: "Pepe",             category: "crypto",      binanceSymbol: "PEPEUSDT", newsKeyword: "PEPE meme coin", icon: "🐸" },
  { symbol: "SHIB/USDT", name: "Shiba Inu",        category: "crypto",      binanceSymbol: "SHIBUSDT", newsKeyword: "Shiba Inu SHIB", icon: "🐕" },
  { symbol: "FLOKI/USDT",name: "Floki",            category: "crypto",      binanceSymbol: "FLOKIUSDT",newsKeyword: "Floki meme coin",icon: "🐶" },
  { symbol: "WIF/USDT",  name: "dogwifhat",        category: "crypto",      binanceSymbol: "WIFUSDT",  newsKeyword: "dogwifhat WIF",  icon: "🎩" },
  { symbol: "BONK/USDT", name: "Bonk",             category: "crypto",      binanceSymbol: "BONKUSDT", newsKeyword: "Bonk BONK",      icon: "🏏" },
  { symbol: "FARTCOIN/USD",  name: "Fartcoin",     category: "crypto",      yahooSymbol: "FARTCOIN-USD",  newsKeyword: "Fartcoin",   icon: "💨" },

  // ─── Indices ──────────────────────────────────────────────
  { symbol: "SPX",      name: "S&P 500",                    category: "indices", yahooSymbol: "^GSPC",      newsKeyword: "S&P 500 stock market",        icon: "📈" },
  { symbol: "NDX",      name: "Nasdaq-100",                 category: "indices", yahooSymbol: "^NDX",       newsKeyword: "Nasdaq 100 tech",             icon: "💻" },
  { symbol: "DJI",      name: "Dow Jones Industrial Average", category: "indices", yahooSymbol: "^DJI",       newsKeyword: "Dow Jones DJIA",              icon: "🏛️" },
  { symbol: "FTSE",     name: "FTSE 100",                   category: "indices", yahooSymbol: "^FTSE",      newsKeyword: "FTSE 100 UK stocks",          icon: "🇬🇧" },
  { symbol: "DAX",      name: "DAX 40",                     category: "indices", yahooSymbol: "^GDAXI",     newsKeyword: "DAX Germany index",           icon: "🇩🇪" },
  { symbol: "N225",     name: "Nikkei 225",                 category: "indices", yahooSymbol: "^N225",      newsKeyword: "Nikkei 225 Japan",            icon: "🇯🇵" },
  { symbol: "HSI",      name: "Hang Seng Index",            category: "indices", yahooSymbol: "^HSI",       newsKeyword: "Hang Seng Hong Kong",         icon: "🇭🇰" },
  { symbol: "TSX",      name: "S&P/TSX Composite",          category: "indices", yahooSymbol: "^GSPTSE",    newsKeyword: "S&P TSX Composite Canada",    icon: "🇨🇦" },
  { symbol: "SHCOMP",   name: "Shanghai Composite",         category: "indices", yahooSymbol: "000001.SS",  newsKeyword: "Shanghai Composite China",    icon: "��" },
  { symbol: "ESTX50",   name: "EURO STOXX 50",              category: "indices", yahooSymbol: "^STOXX50E",  newsKeyword: "Euro Stoxx 50 Europe",        icon: "🇪🇺" },
  { symbol: "CAC40",    name: "CAC 40",                     category: "indices", yahooSymbol: "^FCHI",      newsKeyword: "CAC 40 France",               icon: "��" },
  { symbol: "BVSP",     name: "Bovespa Index",              category: "indices", yahooSymbol: "^BVSP",      newsKeyword: "Bovespa Brazil index",        icon: "🇧🇷" },
  { symbol: "ASX200",   name: "ASX 200",                    category: "indices", yahooSymbol: "^AXJO",      newsKeyword: "ASX 200 Australia",           icon: "🇦🇺" },
  { symbol: "IPC",      name: "IPC Mexico",                 category: "indices", yahooSymbol: "^MXX",       newsKeyword: "IPC Mexico index",            icon: "🇲🇽" },
  { symbol: "BVLPG",    name: "S&P/BVL Peru General",       category: "indices", yahooSymbol: "^SPBLPGPT",  newsKeyword: "S&P BVL Peru General",        icon: "��" },
  { symbol: "JSE40",    name: "FTSE/JSE Top 40",            category: "indices", yahooSymbol: "J200.L",     newsKeyword: "FTSE JSE Top 40 South Africa", icon: "🇿🇦" },
  { symbol: "KOSPI",    name: "KOSPI",                      category: "indices", yahooSymbol: "^KS11",      newsKeyword: "KOSPI South Korea",           icon: "🇰🇷" },
  { symbol: "RUT",      name: "Russell 2000",               category: "indices", yahooSymbol: "^RUT",       newsKeyword: "Russell 2000 small cap",      icon: "🧢" },
  { symbol: "IBEX",     name: "IBEX 35",                    category: "indices", yahooSymbol: "^IBEX",      newsKeyword: "IBEX 35 Spain",               icon: "��" },

  // ─── Commodities ──────────────────────────────────────────
  { symbol: "XAU/USD", name: "Gold",         category: "commodities", yahooSymbol: "GC=F",  newsKeyword: "Gold price commodity",    icon: "🥇" },
  { symbol: "XAG/USD", name: "Silver",       category: "commodities", yahooSymbol: "SI=F",  newsKeyword: "Silver price commodity",  icon: "🥈" },
  { symbol: "WTI",     name: "Crude Oil",    category: "commodities", yahooSymbol: "CL=F",  newsKeyword: "crude oil WTI price",     icon: "🛢️" },
  { symbol: "BRENT",   name: "Brent Oil",    category: "commodities", yahooSymbol: "BZ=F",  newsKeyword: "Brent crude oil price",   icon: "⛽" },
  { symbol: "NG",      name: "Natural Gas",  category: "commodities", yahooSymbol: "NG=F",  newsKeyword: "natural gas price",       icon: "🔥" },
  { symbol: "COPPER",  name: "Copper",       category: "commodities", yahooSymbol: "HG=F",  newsKeyword: "copper price commodity",  icon: "🪙" },

  // ─── Forex ────────────────────────────────────────────────
  { symbol: "EUR/USD", name: "Euro / US Dollar",     category: "forex", yahooSymbol: "EURUSD=X", newsKeyword: "EUR USD euro dollar",    icon: "€" },
  { symbol: "GBP/USD", name: "Pound / US Dollar",    category: "forex", yahooSymbol: "GBPUSD=X", newsKeyword: "GBP USD pound sterling", icon: "£" },
  { symbol: "USD/JPY", name: "US Dollar / Yen",      category: "forex", yahooSymbol: "JPY=X",    newsKeyword: "USD JPY yen dollar",     icon: "¥" },
  { symbol: "USD/CHF", name: "US Dollar / Franc",    category: "forex", yahooSymbol: "CHF=X",    newsKeyword: "USD CHF Swiss franc",    icon: "₣" },
  { symbol: "AUD/USD", name: "Aussie / US Dollar",   category: "forex", yahooSymbol: "AUDUSD=X", newsKeyword: "AUD USD Australian",     icon: "🦘" },
  { symbol: "USD/CAD", name: "US Dollar / CAD",      category: "forex", yahooSymbol: "CAD=X",    newsKeyword: "USD CAD Canadian dollar", icon: "🍁" },
  { symbol: "NZD/USD", name: "Kiwi / US Dollar",     category: "forex", yahooSymbol: "NZDUSD=X", newsKeyword: "NZD USD New Zealand",    icon: "🥝" },
  { symbol: "EUR/GBP", name: "Euro / Pound",          category: "forex", yahooSymbol: "EURGBP=X", newsKeyword: "EUR GBP euro pound",     icon: "🇪🇺" },
  { symbol: "EUR/JPY", name: "Euro / Yen",            category: "forex", yahooSymbol: "EURJPY=X", newsKeyword: "EUR JPY euro yen",       icon: "🗾" },
  { symbol: "USD/TRY", name: "US Dollar / Lira",      category: "forex", yahooSymbol: "TRY=X",    newsKeyword: "USD TRY Turkish lira",   icon: "🇹🇷" },
];

/** Default watchlist symbols shown on first launch */
export const DEFAULT_WATCHLIST = ["BTC/USDT", "ETH/USDT", "DOGE/USDT", "PEPE/USDT", "SHIB/USDT", "XAU/USD", "SPX", "WTI"];

/** Find a single asset by symbol */
export function findAsset(symbol: string): Asset | undefined {
  return ASSET_CATALOG.find((a) => a.symbol === symbol);
}

export function symbolToSlug(symbol: string): string {
  return symbol.replace(/\//g, "-").toLowerCase();
}

export function findAssetBySlug(slug: string): Asset | undefined {
  return ASSET_CATALOG.find((asset) => symbolToSlug(asset.symbol) === slug.toLowerCase());
}

export function assetHref(symbol: string): string {
  return `/market/${symbolToSlug(symbol)}`;
}

/** Category labels for display */
export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  crypto:      "Crypto",
  indices:     "Indices",
  commodities: "Commodities",
  forex:       "Forex",
};
