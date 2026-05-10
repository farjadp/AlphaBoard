import { NextResponse } from "next/server";
import { ASSET_CATALOG } from "@/lib/assetCatalog";

export const revalidate = 300; // Cache for 5 minutes

interface DefiLlamaProtocolRow {
  slug: string;
  total24h?: number | null;
  total7d?: number | null;
  total30d?: number | null;
}

interface DefiLlamaOverview {
  protocols?: DefiLlamaProtocolRow[];
}

interface CashflowEntry {
  fees24h: number | null;
  fees7d: number | null;
  fees30d: number | null;
  revenue24h: number | null;
  revenue7d: number | null;
  revenue30d: number | null;
}

// Map our symbols to DefiLlama slugs
const SYMBOL_TO_SLUG: Record<string, string> = {
  "BTC/USDT": "bitcoin",
  "ETH/USDT": "ethereum",
};

const TRADFI_SYMBOLS = ASSET_CATALOG.filter((asset) => asset.category !== "crypto").map((asset) => asset.symbol);

export async function GET() {
  try {
    const [feesRes, revRes] = await Promise.all([
      fetch("https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyFees", {
        next: { revalidate: 300 },
      }),
      fetch("https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyRevenue", {
        next: { revalidate: 300 },
      }),
    ]);

    if (!feesRes.ok || !revRes.ok) {
      throw new Error("Failed to fetch from DefiLlama");
    }

    const feesData = await feesRes.json() as DefiLlamaOverview;
    const revData = await revRes.json() as DefiLlamaOverview;

    const cashflowBySymbol: Record<string, CashflowEntry> = {};

    for (const [symbol, slug] of Object.entries(SYMBOL_TO_SLUG)) {
      const feesProtocol = feesData.protocols?.find((protocol) => protocol.slug === slug);
      const revProtocol = revData.protocols?.find((protocol) => protocol.slug === slug);

      cashflowBySymbol[symbol] = {
        fees24h: feesProtocol?.total24h || null,
        fees7d: feesProtocol?.total7d || null,
        fees30d: feesProtocol?.total30d || null,
        revenue24h: revProtocol?.total24h || null,
        revenue7d: revProtocol?.total7d || null,
        revenue30d: revProtocol?.total30d || null,
      };
    }

    for (const symbol of TRADFI_SYMBOLS) {
      cashflowBySymbol[symbol] = {
        fees24h: null,
        fees7d: null,
        fees30d: null,
        revenue24h: null,
        revenue7d: null,
        revenue30d: null,
      };
    }

    return NextResponse.json(cashflowBySymbol);
  } catch (error) {
    console.error("Cashflow API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
