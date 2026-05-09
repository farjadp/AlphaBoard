import { NextResponse } from "next/server";

export const revalidate = 300; // Cache for 5 minutes

// Map our symbols to CoinGecko IDs
const SYMBOL_TO_CG_ID: Record<string, string> = {
  "BTC/USDT": "bitcoin",
  "ETH/USDT": "ethereum",
};

const TRADFI_SYMBOLS = ["XAU/USD", "SPX", "DJI", "NDX", "WTI"];

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

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error("Invalid format from CoinGecko");
    }

    const balanceSheetBySymbol: Record<string, any> = {};

    for (const [symbol, cgId] of Object.entries(SYMBOL_TO_CG_ID)) {
      const coinData = data.find((c: any) => c.id === cgId);

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
