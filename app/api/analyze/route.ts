import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { readJson } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAsset, requireTimeframe } from "@/lib/market/assets";
import { getIndicatorReport } from "@/lib/market/report";
import { getQuote } from "@/lib/market/quote";
import { getFutures } from "@/lib/market/futures";
import { getNews } from "@/lib/market/news";
import { getBalanceSheet, getCashflow } from "@/lib/market/fundamentals";
import { openaiChatJson } from "@/lib/ai/openai";
import { AnalysisSchema } from "@/lib/ai/schemas";
import { AiError } from "@/lib/ai/errors";
import { buildAnalyzePrompt, sanitizeLessons } from "@/lib/ai/prompts/analyze";

export const dynamic = "force-dynamic";

const Body = z.object({
  symbol: z.string(),
  timeframe: z.string().optional(),
  pastLessons: z.unknown().optional(),
  chartLessons: z.unknown().optional(),
});

/**
 * Strategy report. The client sends only symbol + timeframe (+ its own lessons); every market
 * input is fetched and computed here, so the model never sees client-fabricated indicators.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  enforceRateLimit(req, "ai");
  const body = Body.parse(await readJson(req, 64_000));
  const asset = requireAsset(body.symbol);
  const timeframe = requireTimeframe(body.timeframe, "1H");

  const [report, quote, futures, news, balanceSheet, cashflow] = await Promise.all([
    getIndicatorReport(asset, timeframe),
    getQuote(asset),
    getFutures(asset),
    getNews(asset),
    getBalanceSheet(asset),
    getCashflow(asset),
  ]);

  if (!report.available || !quote) {
    return NextResponse.json(
      { error: "Live market data for this asset/timeframe is unavailable right now, so no analysis was generated.", code: "MARKET_DATA_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const lessons = sanitizeLessons(body);
  const prompt = buildAnalyzePrompt({
    symbol: asset.symbol,
    assetName: asset.name,
    timeframe,
    quote,
    headlines: news.items.slice(0, 5).map((i) => i.headline),
    report,
    futures,
    balanceSheet,
    cashflow,
    ...lessons,
  });

  const analysis = await openaiChatJson({
    feature: "analyze",
    userId: user.id,
    system: "You are a disciplined trading analyst. Respond with a single JSON object only.",
    user: prompt,
    schema: AnalysisSchema,
    maxTokens: 1_800,
    temperature: 0,
  });

  // Sanity bound: levels more than 50% away from the live price are almost certainly hallucinated.
  const far = [analysis.entry, analysis.stopLoss, analysis.takeProfit].some((p) => p > 0 && Math.abs(p / quote.price - 1) > 0.5);
  if (far) throw new AiError("AI_SCHEMA", "levels far from live price");

  return NextResponse.json({
    ...analysis,
    context: {
      symbol: asset.symbol,
      timeframe,
      priceAtSignal: quote.price,
      priceSource: quote.source,
      priceAsOf: quote.asOf,
      consensus: report.consensusScore,
      lessonsUsed: { past: lessons.pastLessons.length, chart: lessons.chartLessons.length },
      generatedAt: new Date().toISOString(),
    },
  });
});
