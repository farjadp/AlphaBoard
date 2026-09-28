/**
 * Client-facing shapes for user data. Shared by the API (lib/db mappers) and the React hooks,
 * so the wire format has exactly one definition.
 */
import type { TradePosition } from "@/lib/journal/pnl";

export type { TradePosition };

// ─── Journal ─────────────────────────────────────────────────────────────────
export type TradeEmotion = "Confident" | "FOMO" | "Panic" | "Neutral" | "Greed" | "Revenge";

export interface PostMortemAnalysis {
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";
  rootCause: string;
  mistakes: string[];
  strengths: string[];
  lesson: string;
  tags: string[];
  generatedAt: string;
}

export interface JournalEntry {
  id: string;
  timestamp: string; // ISO String
  symbol: string;
  position: TradePosition;
  entryPrice: number;
  exitPrice?: number;
  pnlPercent?: number; // NET pnl% (after fees)
  grossPnlPercent?: number; // GROSS pnl% (raw price move × leverage)
  feeRatePercent?: number; // per-side taker fee % (e.g. 0.05 for 0.05%). Undefined = use DEFAULT_FEE_RATE_PERCENT
  pnlSource?: "calculated" | "exchange"; // "exchange" means pnlPercent was provided directly (e.g. from screenshot) and should not be recomputed
  emotion: TradeEmotion;
  notes: string;
  leverage?: number;
  margin?: number;
  marginMode?: "Cross" | "Isolated";
  status: "OPEN" | "CLOSED";
  screenshotUrl?: string; // "/api/attachments/{id}" once stored (a data URL only while an upload is pending)
  postMortem?: PostMortemAnalysis;
}

// ─── Trade lessons (post-mortems) ────────────────────────────────────────────
export type LessonOutcome = "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";

export interface TradeLesson {
  id: string;
  tradeId: string;
  symbol: string;
  position: "LONG" | "SHORT" | "SPOT";
  outcome: LessonOutcome;
  pnlPercent?: number;
  timeframe?: string;
  rootCause: string;
  mistakes: string[];
  strengths: string[];
  lesson: string;
  tags: string[];
  emotion?: string;
  timestamp: string;
}

// ─── AI strategy archive ─────────────────────────────────────────────────────
export interface ArchivedSignal {
  id: string;
  timestamp: string; // Precise ISO string
  symbol: string;
  price: number;
  signal: string;
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
  reasoning: string;
  indicators_breakdown?: Array<{
    name: string;
    value: string;
    signal: "Bullish" | "Bearish" | "Neutral";
    explanation: string;
  }>;
}

// ─── Chart academy ───────────────────────────────────────────────────────────
export type AnnotationType =
  | "hline" | "line" | "zone" | "arrow_up" | "arrow_down"
  | "marker" | "channel" | "fib" | "label";

export type AnnotationCategory =
  | "support" | "resistance" | "ob_bull" | "ob_bear"
  | "fvg_bull" | "fvg_bear" | "entry" | "sl" | "tp"
  | "trendline" | "bos" | "choch" | "pattern"
  | "candlestick" | "ema" | "liquidity" | "other";

export interface Annotation {
  type: AnnotationType;
  category?: AnnotationCategory;
  color: string;
  label?: string;
  priority?: "high" | "medium" | "low";
  note?: string;
  // hline: y only
  y?: number;
  // line / trendline
  x1?: number; y1?: number;
  x2?: number; y2?: number;
  // zone / rectangle (z-prefix to avoid collision)
  zx?: number; zy?: number; zw?: number; zh?: number;
  // marker / arrow_up / arrow_down / label: single point
  mx?: number; my?: number;
  // channel: two parallel lines
  cy1a?: number; cy1b?: number; cy2a?: number; cy2b?: number;
  // style
  dashed?: boolean;
  thickness?: number;
  fillOpacity?: number;
}

export type Timeframe = "15m" | "1H" | "4H" | "1D";

export interface TimeframeChart {
  timeframe: Timeframe;
  imageDataUrl: string; // image URL: "/api/attachments/{id}" (or a data URL before saving)
  annotations: Annotation[];
  signal?: "BUY" | "SELL" | "HOLD";
  bias?: string;
}

export interface ChartLesson {
  id: string;
  createdAt: string; // ISO
  symbol?: string;
  overallSignal: "BUY" | "SELL" | "HOLD";
  confluenceScore: number; // 0–100
  summary: string; // AI short summary
  lesson: string; // the educational takeaway
  patterns: string[];
  tags: string[];
  charts: TimeframeChart[]; // up to 3 timeframes
  // For feeding back into analyze API
  rootCause?: string;
  mistakes?: string[];
  strengths?: string[];
}

// ─── Price alerts ────────────────────────────────────────────────────────────
export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: "above" | "below";
  createdAt: string;
  triggered: boolean;
  triggeredAt?: string;
}
