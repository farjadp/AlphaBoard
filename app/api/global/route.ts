import { NextResponse } from "next/server";
import { formatMarketCap } from "@/lib/binance";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { tooManyRequests } from "@/lib/http/errors";
import { clientIp, limiters } from "@/lib/http/rateLimit";

async function GET_impl() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global", {
      next: { revalidate: 60 },
      headers: { accept: "application/json" },
    });

    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

    const { data } = (await res.json()) as {
      data: {
        market_cap_percentage: Record<string, number>;
        total_market_cap: Record<string, number>;
        market_cap_change_percentage_24h_usd: number;
      };
    };

    return NextResponse.json({
      btcDominance: data.market_cap_percentage.btc.toFixed(1) + "%",
      ethDominance: data.market_cap_percentage.eth.toFixed(1) + "%",
      totalMarketCap: formatMarketCap(data.total_market_cap.usd),
      marketCapChange24h: data.market_cap_change_percentage_24h_usd.toFixed(2),
    });
  } catch (err) {
    console.error("CoinGecko fetch failed:", err);
    return NextResponse.json({
      btcDominance: "—",
      ethDominance: "—",
      totalMarketCap: "—",
      marketCapChange24h: "0",
    });
  }
}


export const GET = route(async (req) => {
  await requireUser();
  const rl = limiters.api.check(clientIp(req));
  if (!rl.allowed) throw tooManyRequests(rl.retryAfterMs);
  return GET_impl();
});
