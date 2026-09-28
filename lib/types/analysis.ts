/** Strategy report as returned by POST /api/analyze. */
export interface AnalysisResult {
  /** Id of the archived signal the server saved for this report. */
  id?: string;
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  timeframe: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  tradeStyle?: string;
  risk_management?: {
    leverage: string;
    leverageReasoning: string;
    positionSize: string;
    sizeReasoning: string;
    riskRewardRatio: string;
    distanceToTarget: string;
  };
  supportResistance?: { support: number[]; resistance: number[] };
  safeEntries?: Array<{ price: number; reasoning: string }>;
  reasoning: string;
  indicators_breakdown?: Array<{
    name: string;
    value: string;
    signal: "Bullish" | "Bearish" | "Neutral";
    explanation: string;
  }>;
  /** What the server actually used — recorded with the archived signal. */
  context?: {
    symbol: string;
    timeframe: string;
    priceAtSignal: number;
    priceSource: string;
    priceAsOf: string;
    lessonsUsed: { past: number; chart: number };
    generatedAt: string;
    ai?: { provider: string; model: string; inputTokens: number; outputTokens: number; costUsd: number };
  };
}

export const AI_ERROR_HINTS: Record<string, string> = {
  AI_NOT_CONFIGURED: "AI analysis is not configured on the server (missing API key).",
  MARKET_DATA_UNAVAILABLE: "Live market data is unavailable right now, so no plan was generated. Try again shortly or pick another timeframe.",
  RATE_LIMITED: "Too many analyses in a short time. Please wait a few minutes.",
  AI_QUOTA: "You have used today's AI allowance. It resets at 00:00 UTC; an administrator can raise your limit.",
};
