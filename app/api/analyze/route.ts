import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = process.env.OPENAI_API_KEY;
    const news = Array.isArray(body.news) ? (body.news as string[]) : [];
    const selectedTimeframe = typeof body.selectedTimeframe === "string" ? body.selectedTimeframe : (body.indicators?.timeframe || "1H");
    type IncomingLesson = {
      symbol?: string;
      position?: string;
      outcome?: string;
      pnlPercent?: number;
      rootCause?: string;
      lesson?: string;
      tags?: string[];
    };
    const pastLessons = Array.isArray(body.pastLessons) ? (body.pastLessons as IncomingLesson[]).slice(0, 6) : [];
    const lessonsBlock = pastLessons.length > 0
      ? pastLessons
          .map((lesson, idx) => {
            const tags = Array.isArray(lesson.tags) ? lesson.tags.join(", ") : "";
            const pnl = typeof lesson.pnlPercent === "number" ? `${lesson.pnlPercent.toFixed(2)}%` : "N/A";
            return `${idx + 1}. [${lesson.outcome || "?"} · ${lesson.symbol || "?"} · ${lesson.position || "?"} · ${pnl}] ${lesson.rootCause || ""} → Lesson: ${lesson.lesson || ""}${tags ? ` (tags: ${tags})` : ""}`;
          })
          .join("\n")
      : "No prior lessons recorded.";
    const multiTimeframes = Array.isArray(body.indicators?.multiTimeframes)
      ? body.indicators.multiTimeframes as Array<{ timeframe: string; trendSignal?: string; rsiSignal?: string; macdSignal?: string; emaSignal?: string; available?: boolean }>
      : [];
    const consensusScore = body.indicators?.consensusScore as {
      bullishPressure?: number;
      bearishPressure?: number;
      netScore?: number;
      dominantBias?: "Bullish" | "Bearish" | "Neutral";
      coverage?: number;
    } | undefined;
    const multiTimeframeSummary = multiTimeframes.length > 0
      ? multiTimeframes.map((item) => `${item.timeframe}: ${item.available ? item.trendSignal || "Neutral" : "Unavailable"} | RSI ${item.rsiSignal || "N/A"} | MACD ${item.macdSignal || "N/A"} | EMA ${item.emaSignal || "N/A"}`).join("\n")
      : "No multi-timeframe summary available.";

    // Fallback if no API key is set
    if (!apiKey) {
      await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulate delay
      
      const isPositive = body.priceChange >= 0;
      const candlePattern = body.indicators?.candlestickPattern;
      const chartPattern = body.indicators?.chartPattern;
      return NextResponse.json({
        signal: isPositive ? "HOLD" : "BUY",
        confidence: 65,
        timeframe: selectedTimeframe,
        entry: body.price ? Number((body.price * 0.99).toFixed(2)) : 0,
        stopLoss: body.price ? Number((body.price * 0.97).toFixed(2)) : 0,
        takeProfit: body.price ? Number((body.price * 1.05).toFixed(2)) : 0,
        tradeStyle: "Swing",
        risk_management: {
          leverage: "5x",
          leverageReasoning: "Volatility is average; a conservative 5x leverage prevents liquidation from normal wicks.",
          positionSize: "2% of Capital",
          sizeReasoning: "Standard risk allocation for a mean-reversion setup.",
          riskRewardRatio: "1:2.5",
          distanceToTarget: "500 points"
        },
        reasoning: candlePattern || chartPattern
          ? `MOCK ANALYSIS: On the selected ${selectedTimeframe} timeframe, the latest structure shows ${candlePattern?.name || "no dominant candlestick pattern"}${chartPattern ? ` alongside a ${chartPattern.name}` : ""}. Multi-timeframe view: ${multiTimeframes.filter((item) => item.available && item.trendSignal === "Bullish").length} bullish, ${multiTimeframes.filter((item) => item.available && item.trendSignal === "Bearish").length} bearish, ${multiTimeframes.filter((item) => item.available && item.trendSignal === "Neutral").length} neutral. Consensus score: ${consensusScore?.netScore ?? 50}/100 (${consensusScore?.dominantBias || "Neutral"}). Add OPENAI_API_KEY to your .env.local file to generate a full AI-backed strategy.`
          : "MOCK ANALYSIS: Please add OPENAI_API_KEY to your .env.local file to see real AI analysis.",
        indicators_breakdown: [
          { name: "RSI (14)", value: "55", signal: "Neutral", explanation: "RSI is in the middle range, indicating neither overbought nor oversold." },
          { name: "MACD", value: "0.1", signal: "Bullish", explanation: "MACD crossed above the signal line, suggesting upward momentum." },
          { name: "Candlestick Pattern", value: candlePattern?.name || "No Clear Pattern", signal: candlePattern?.bias || "Neutral", explanation: candlePattern?.description || "No dominant candlestick pattern is active on the latest candles." },
          { name: "Chart Pattern", value: chartPattern?.name || "No Clear Chart Pattern", signal: chartPattern?.bias || "Neutral", explanation: chartPattern?.description || "No dominant chart pattern is active in the recent structure." }
        ]
      });
    }

    const prompt = `
You are an elite, highly active crypto and TradFi trader and risk manager. Analyze the following asset data to find the best actionable setup for the user's selected timeframe.
IMPORTANT: While your goal is to find actionable setups, if the market indicators are genuinely conflicting, choppy, or directionless, you MUST signal "HOLD" and explain why patience is required. Do not force a trade if the edge is not clear.

You also have access to the trader's PERSONAL POST-MORTEM LESSONS from previous trades. Treat them as a personalized memory: avoid repeating mistakes the trader has made before, lean into setups that previously worked for them, and reference relevant past lessons in the "reasoning" field when they directly apply.

You must utilize the following Moving Average Cheat Sheet to speed up your decision making:
•  5 EMA : ⚡ Momentum
•  10 EMA: 🔍 Short-term trend
•  20 EMA: 🎯 Mean reversion
•  50 SMA: 🛡️ Strong uptrend support
•  100 SMA: 📉 Dip buy alert
•  200 SMA: 🔄 Trend shift
•  250 SMA: 💰 Fair value

Return ONLY a valid JSON object with the following exact keys:
- "signal": (must be "BUY", "SELL", or "HOLD". Find the most likely direction, but use HOLD if the market is neutral/conflicting.)
- "confidence": (number between 0 and 100 representing the probability of the trade succeeding)
- "timeframe": (a short string suggesting the ideal timeframe for this trade, e.g. "1H" or "4H")
- "tradeStyle": (must be "Day Trade", "Scalp", or "Swing")
- "entry": (number, suggested exact entry price based on current price and indicators)
- "stopLoss": (number, suggested exact stop loss price)
- "takeProfit": (number, suggested exact take profit price)
- "risk_management": (an object containing exactly these keys: "leverage" (string, e.g. "10x"), "leverageReasoning" (string, logic behind leverage), "positionSize" (string, e.g. "1-2% Risk" or "0.1 Lots"), "sizeReasoning" (string, logic behind size), "riskRewardRatio" (string, e.g. "1:3"), "distanceToTarget" (string, e.g. "150 pips"))
- "supportResistance": (an object containing exactly these keys: "support" (array of up to 3 major support levels as numbers, from closest to furthest), "resistance" (array of up to 3 major resistance levels as numbers, from closest to furthest))
- "safeEntries": (array of 1 to 3 objects, each with "price" (number) and "reasoning" (string, explaining why this is a safe, standard entry point based on liquidity or structure))
- "reasoning": (a short paragraph explaining the overarching strategy, showing how all these factors were calculated and considered for the final signal)
- "indicators_breakdown": (an array of exactly 5 objects, one for each major indicator: RSI, MACD, SMA, EMA, Bollinger Bands. Each object must have exactly these keys: "name" (e.g. "RSI (14)"), "value" (a string showing the current value), "signal" (must be exactly "Bullish", "Bearish", or "Neutral"), and "explanation" (a concise 1-sentence explanation of what this indicator implies for this asset right now))

Data:
${body.symbol} ...
... (the data block remains the same)
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt + `\n\nData:\nSymbol: ${body.symbol}\nCurrent Price: $${body.price}\n24h Change: ${body.priceChange}%\nSelected Report Timeframe: ${selectedTimeframe}\n\nRecent News Headlines:\n${news.length > 0 ? news.map((headline) => '- ' + headline).join("\\n") : "No recent news."}\n\nTechnical Indicators (${selectedTimeframe} Chart):\nRSI (14): ${body.indicators?.rsi ? body.indicators.rsi.toFixed(2) : "N/A"} (${body.indicators?.rsiSignal || "N/A"})\nMACD: ${body.indicators?.macd?.MACD ? body.indicators.macd.MACD.toFixed(2) : "N/A"} (${body.indicators?.macdSignal || "N/A"})\nSMA (50): ${body.indicators?.sma50 ? body.indicators.sma50.toFixed(2) : "N/A"}\nSMA (100): ${body.indicators?.sma100 ? body.indicators.sma100.toFixed(2) : "N/A"}\nSMA (200): ${body.indicators?.sma200 ? body.indicators.sma200.toFixed(2) : "N/A"}\nSMA (250): ${body.indicators?.sma250 ? body.indicators.sma250.toFixed(2) : "N/A"}\nEMA (5): ${body.indicators?.ema5 ? body.indicators.ema5.toFixed(2) : "N/A"}\nEMA (10): ${body.indicators?.ema10 ? body.indicators.ema10.toFixed(2) : "N/A"}\nEMA (20): ${body.indicators?.ema20 ? body.indicators.ema20.toFixed(2) : "N/A"}\nBollinger Bands (20,2): Lower: ${body.indicators?.bollingerBands?.lower ? body.indicators.bollingerBands.lower.toFixed(2) : "N/A"}, Upper: ${body.indicators?.bollingerBands?.upper ? body.indicators.bollingerBands.upper.toFixed(2) : "N/A"} (${body.indicators?.bbSignal || "N/A"})\nCandlestick Pattern (${selectedTimeframe}): ${body.indicators?.candlestickPattern?.name || "No Clear Pattern"} (${body.indicators?.candlestickPattern?.bias || "Neutral"})\nCandlestick Pattern Note: ${body.indicators?.candlestickPattern?.description || "No dominant candlestick pattern available."}\nChart Pattern (${selectedTimeframe}): ${body.indicators?.chartPattern?.name || "No Clear Chart Pattern"} (${body.indicators?.chartPattern?.bias || "Neutral"})\nChart Pattern Note: ${body.indicators?.chartPattern?.description || "No dominant chart pattern available."}\n\nMulti-Timeframe Summary:\n${multiTimeframeSummary}\n\nConsensus Score:\nNet Score: ${consensusScore?.netScore ?? "N/A"}\nDominant Bias: ${consensusScore?.dominantBias || "N/A"}\nBullish Pressure: ${consensusScore?.bullishPressure ?? "N/A"}\nBearish Pressure: ${consensusScore?.bearishPressure ?? "N/A"}\nCoverage: ${consensusScore?.coverage ?? "N/A"}%\n\nTrader's Past Post-Mortem Lessons:\n${lessonsBlock}\n\nFundamental & Network Data:\nCashflow 24h Fees: ${body.cashflow?.fees24h || "N/A"}\nCashflow 24h Revenue: ${body.cashflow?.revenue24h || "N/A"}\nBalance Sheet Market Cap: ${body.balanceSheet?.marketCap || "N/A"}\nBalance Sheet FDV: ${body.balanceSheet?.fdv || "N/A"}\nFutures Funding Rate: ${body.futures?.fundingRate || "N/A"}\nFutures Open Interest: ${body.futures?.openInterest || "N/A"}\n` }],
        response_format: { type: "json_object" },
        temperature: 0,
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
