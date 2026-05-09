import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = process.env.OPENAI_API_KEY;

    // Fallback if no API key is set
    if (!apiKey) {
      await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulate delay
      
      const isPositive = body.priceChange >= 0;
      return NextResponse.json({
        signal: isPositive ? "HOLD" : "BUY",
        confidence: 65,
        timeframe: "4H",
        entry: body.price ? Number((body.price * 0.99).toFixed(2)) : 0,
        stopLoss: body.price ? Number((body.price * 0.97).toFixed(2)) : 0,
        takeProfit: body.price ? Number((body.price * 1.05).toFixed(2)) : 0,
        reasoning: "MOCK ANALYSIS: Please add OPENAI_API_KEY to your .env.local file to see real AI analysis. Based on simulated data, technicals align with steady cashflow, offering a reasonable setup.",
        indicators_breakdown: [
          { name: "RSI (14)", value: "55", signal: "Neutral", explanation: "RSI is in the middle range, indicating neither overbought nor oversold." },
          { name: "MACD", value: "0.1", signal: "Bullish", explanation: "MACD crossed above the signal line, suggesting upward momentum." }
        ]
      });
    }

    const prompt = `
You are an elite, highly active INTRADAY crypto and TradFi day trader and risk manager. Analyze the following asset data to find short-term trading opportunities.
Do not be overly conservative; your goal is to find actionable setups for the current trading session based on the provided timeframe data.

You must utilize the following Moving Average Cheat Sheet to speed up your decision making:
•  5 EMA : ⚡ Momentum
•  10 EMA: 🔍 Short-term trend
•  20 EMA: 🎯 Mean reversion
•  50 SMA: 🛡️ Strong uptrend support
•  100 SMA: 📉 Dip buy alert
•  200 SMA: 🔄 Trend shift
•  250 SMA: 💰 Fair value

Return ONLY a valid JSON object with the following exact keys:
- "signal": (must be "BUY", "SELL", or "HOLD". Find the most likely direction for a trade.)
- "confidence": (number between 0 and 100 representing the probability of the trade succeeding)
- "timeframe": (a short string suggesting the ideal timeframe for this trade, e.g. "1H" or "4H")
- "entry": (number, suggested exact entry price based on current price and indicators)
- "stopLoss": (number, suggested exact stop loss price)
- "takeProfit": (number, suggested exact take profit price)
- "reasoning": (a short paragraph explaining the strategy and reasoning)
- "indicators_breakdown": (an array of exactly 5 objects, one for each major indicator: RSI, MACD, SMA, EMA, Bollinger Bands. Each object must have exactly these keys: "name" (e.g. "RSI (14)"), "value" (a string showing the current value), "signal" (must be exactly "Bullish", "Bearish", or "Neutral"), and "explanation" (a concise 1-sentence explanation of what this indicator implies for this asset right now))

Data:
Symbol: ${body.symbol}
Current Price: $${body.price}
24h Change: ${body.priceChange}%

Recent News Headlines:
${body.news && body.news.length > 0 ? body.news.map((n: any) => `- ${n}`).join("\n") : "No recent news."}

Technical Indicators (1H Intraday Chart):
RSI (14): ${body.indicators?.rsi ? body.indicators.rsi.toFixed(2) : "N/A"} (${body.indicators?.rsiSignal || "N/A"})
MACD: ${body.indicators?.macd?.MACD ? body.indicators.macd.MACD.toFixed(2) : "N/A"} (${body.indicators?.macdSignal || "N/A"})
SMA (50): ${body.indicators?.sma50 ? body.indicators.sma50.toFixed(2) : "N/A"}
SMA (100): ${body.indicators?.sma100 ? body.indicators.sma100.toFixed(2) : "N/A"}
SMA (200): ${body.indicators?.sma200 ? body.indicators.sma200.toFixed(2) : "N/A"}
SMA (250): ${body.indicators?.sma250 ? body.indicators.sma250.toFixed(2) : "N/A"}
EMA (5): ${body.indicators?.ema5 ? body.indicators.ema5.toFixed(2) : "N/A"}
EMA (10): ${body.indicators?.ema10 ? body.indicators.ema10.toFixed(2) : "N/A"}
EMA (20): ${body.indicators?.ema20 ? body.indicators.ema20.toFixed(2) : "N/A"}
Bollinger Bands (20,2): Lower: ${body.indicators?.bollingerBands?.lower ? body.indicators.bollingerBands.lower.toFixed(2) : "N/A"}, Upper: ${body.indicators?.bollingerBands?.upper ? body.indicators.bollingerBands.upper.toFixed(2) : "N/A"} (${body.indicators?.bbSignal || "N/A"})

Fundamental & Network Data:
Cashflow 24h Fees: ${body.cashflow?.fees24h || "N/A"}
Cashflow 24h Revenue: ${body.cashflow?.revenue24h || "N/A"}
Balance Sheet Market Cap: ${body.balanceSheet?.marketCap || "N/A"}
Balance Sheet FDV: ${body.balanceSheet?.fdv || "N/A"}
Futures Funding Rate: ${body.futures?.fundingRate || "N/A"}
Futures Open Interest: ${body.futures?.openInterest || "N/A"}
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    return NextResponse.json(result);
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return NextResponse.json(
      { error: "Failed to generate AI analysis" },
      { status: 500 }
    );
  }
}
