import { NextResponse } from "next/server";
import { RSI, MACD, SMA, EMA, BollingerBands } from "technicalindicators";
import YahooFinance from "yahoo-finance2";
import { PAIRS } from "@/lib/mockData";

const yf = new YahooFinance();

export const revalidate = 300; // Cache for 5 minutes

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");

    if (!symbol) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }

    const pairDef = PAIRS.find((p) => p.symbol === symbol);
    if (!pairDef) {
      return NextResponse.json({ error: "Unsupported symbol" }, { status: 400 });
    }

    let closes: number[] = [];

    if (pairDef.type === "crypto") {
      // Binance flow
      const binanceSymbol = symbol.replace("/", "").toUpperCase();
      const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1h&limit=300`;
      const res = await fetch(url, { next: { revalidate: 300 } });

      if (!res.ok) {
        throw new Error(`Failed to fetch klines from Binance: ${res.statusText}`);
      }

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Invalid kline data");
      }

      closes = data.map((k: any) => parseFloat(k[4]));
    } else if (pairDef.type === "tradfi" && pairDef.yahooSymbol) {
      // Yahoo Finance flow
      // Since Yahoo Finance API usually doesn't give free 1H data easily without special auth, 
      // we'll fetch 1d data for the last 100 days to calculate indicators for TradFi.
      const now = new Date();
      const past = new Date();
      past.setDate(now.getDate() - 400); // Get enough days to ensure 300 trading days
      
      const queryOptions = { period1: past.toISOString().split("T")[0], interval: '1d' as const };
      const result = await yf.historical(pairDef.yahooSymbol, queryOptions) as any[];
      
      if (!result || result.length === 0) {
        throw new Error("Invalid Yahoo Finance data");
      }
      
      // take the last 300 closes
      closes = result.map((r: any) => r.close).slice(-300);
    } else {
      throw new Error("Unknown asset type");
    }

    // Calculate RSI (14)
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    const latestRsi = rsiValues[rsiValues.length - 1];

    // Calculate MACD (12, 26, 9)
    const macdValues = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const latestMacd = macdValues[macdValues.length - 1];

    // Calculate SMAs
    const sma50Values = SMA.calculate({ values: closes, period: 50 });
    const latestSma50 = sma50Values[sma50Values.length - 1];
    
    const sma100Values = SMA.calculate({ values: closes, period: 100 });
    const latestSma100 = sma100Values[sma100Values.length - 1] || null;

    const sma200Values = SMA.calculate({ values: closes, period: 200 });
    const latestSma200 = sma200Values[sma200Values.length - 1] || null;

    const sma250Values = SMA.calculate({ values: closes, period: 250 });
    const latestSma250 = sma250Values[sma250Values.length - 1] || null;

    // Calculate EMAs
    const ema5Values = EMA.calculate({ values: closes, period: 5 });
    const latestEma5 = ema5Values[ema5Values.length - 1];

    const ema10Values = EMA.calculate({ values: closes, period: 10 });
    const latestEma10 = ema10Values[ema10Values.length - 1];

    const ema20Values = EMA.calculate({ values: closes, period: 20 });
    const latestEma20 = ema20Values[ema20Values.length - 1];

    // Calculate Bollinger Bands (20, 2)
    const bbValues = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
    const latestBb = bbValues[bbValues.length - 1];

    const currentPrice = closes[closes.length - 1];

    // Determine basic signals
    const rsiSignal = latestRsi > 70 ? "Overbought" : latestRsi < 30 ? "Oversold" : "Neutral";
    const macdSignal = (latestMacd?.MACD ?? 0) > (latestMacd?.signal ?? 0) ? "Bullish" : "Bearish";
    const smaSignal = currentPrice > latestSma50 ? "Above 50 SMA" : "Below 50 SMA";
    const emaSignal = currentPrice > latestEma20 ? "Above 20 EMA" : "Below 20 EMA";
    
    let bbSignal = "Neutral";
    if (latestBb) {
      if (currentPrice > latestBb.upper) bbSignal = "Above Upper Band (Overextended)";
      else if (currentPrice < latestBb.lower) bbSignal = "Below Lower Band (Oversold)";
      else bbSignal = "Inside Bands";
    }

    return NextResponse.json({
      rsi: latestRsi,
      rsiSignal,
      macd: latestMacd,
      macdSignal,
      sma50: latestSma50,
      sma100: latestSma100,
      sma200: latestSma200,
      sma250: latestSma250,
      smaSignal,
      ema5: latestEma5,
      ema10: latestEma10,
      ema20: latestEma20,
      emaSignal,
      bollingerBands: latestBb,
      bbSignal,
      currentPrice,
    });
  } catch (error) {
    console.error("Indicators API Error:", error);
    return NextResponse.json({ error: "Failed to calculate indicators" }, { status: 500 });
  }
}
