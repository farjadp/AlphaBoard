import { NextResponse } from "next/server";
import { ASSET_CATALOG } from "@/lib/assetCatalog";

export const revalidate = 300; // Cache for 5 minutes

interface CoinGeckoMarketRow {
  id: string;
  market_cap?: number | null;
  fully_diluted_valuation?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
}

interface BalanceSheetEntry {
  marketCap: number | null;
  fdv: number | null;
  circulatingSupply: number | null;
  maxSupply: number | null;
}

// Map our symbols to CoinGecko IDs
const SYMBOL_TO_CG_ID: Record<string, string> = {
  "BTC/USDT": "bitcoin",
  "ETH/USDT": "ethereum",
};

const TRADFI_SYMBOLS = ASSET_CATALOG.filter((asset) => asset.category !== "crypto").map((asset) => asset.symbol);

export async function GET() {
  try {
    const ids = Object.values(SYMBOL_TO_CG_ID).join(",");
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}`;
    
    const res = await fetch(url, {
      next: { revalidate: 300 },
      headers: {
        "Accept": "application/json",
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch from CoinGecko: ${res.statusText}`);
    }

    const data = await res.json() as CoinGeckoMarketRow[];
    if (!Array.isArray(data)) {
      throw new Error("Invalid format from CoinGecko");
    }

    const balanceSheetBySymbol: Record<string, BalanceSheetEntry> = {};

    for (const [symbol, cgId] of Object.entries(SYMBOL_TO_CG_ID)) {
      const coinData = data.find((coin) => coin.id === cgId);

      balanceSheetBySymbol[symbol] = {
        marketCap: coinData?.market_cap || null,
        fdv: coinData?.fully_diluted_valuation || null,
        circulatingSupply: coinData?.circulating_supply || null,
        maxSupply: coinData?.total_supply || coinData?.max_supply || null,
      };
    }

    for (const symbol of TRADFI_SYMBOLS) {
      balanceSheetBySymbol[symbol] = {
        marketCap: null,
        fdv: null,
        circulatingSupply: null,
        maxSupply: null,
      };
    }

    return NextResponse.json(balanceSheetBySymbol);
  } catch (error) {
    console.error("Balance Sheet API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
