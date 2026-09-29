/** Request-body schemas for user-data routes. Shared by routes and the import path. */
import { z } from "zod";

/** JSON has no undefined; clients send null for "not set". Treat both as absent. */
export const opt = <S extends z.ZodType>(schema: S) => z.preprocess((v) => (v === null || v === "" ? undefined : v), schema.optional());

export const TRADE_EMOTIONS = ["Confident", "FOMO", "Panic", "Neutral", "Greed", "Revenge"] as const;

export const PostMortemInput = z.object({
  outcome: z.enum(["WIN", "LOSS", "BREAKEVEN", "OPEN"]),
  rootCause: z.string().max(2000),
  mistakes: z.array(z.string().max(400)).max(8),
  strengths: z.array(z.string().max(400)).max(8),
  lesson: z.string().max(2000),
  tags: z.array(z.string().max(40)).max(10),
  generatedAt: z.string().max(40),
});

export const JournalCreateInput = z.object({
  symbol: z.string().trim().min(1).max(30),
  position: z.enum(["LONG", "SHORT", "SPOT"]),
  entryPrice: z.number().finite().positive(),
  exitPrice: opt(z.number().finite().positive()),
  pnlPercent: opt(z.number().finite()),
  pnlSource: opt(z.enum(["calculated", "exchange"])),
  feeRatePercent: opt(z.number().min(0).max(5)),
  emotion: z.enum(TRADE_EMOTIONS).catch("Neutral"),
  notes: z.string().max(4000).catch(""),
  leverage: opt(z.number().finite().positive().max(1000)),
  margin: opt(z.number().finite().nonnegative()),
  marginMode: opt(z.enum(["Cross", "Isolated"])),
});

export const JournalPatchInput = JournalCreateInput.partial().extend({
  postMortem: opt(PostMortemInput),
  /** A data URL uploads a new screenshot; null removes it; an existing attachment URL is a no-op. */
  screenshotUrl: z.string().max(2_100_000).nullable().optional(),
});

export const LessonInput = z.object({
  tradeId: opt(z.string().max(64)),
  symbol: z.string().trim().min(1).max(30),
  position: z.enum(["LONG", "SHORT", "SPOT"]),
  outcome: z.enum(["WIN", "LOSS", "BREAKEVEN", "OPEN"]),
  pnlPercent: opt(z.number().finite()),
  timeframe: opt(z.string().max(20)),
  rootCause: z.string().max(2000),
  mistakes: z.array(z.string().max(400)).max(8),
  strengths: z.array(z.string().max(400)).max(8),
  lesson: z.string().max(2000),
  tags: z.array(z.string().max(40)).max(10),
  emotion: opt(z.string().max(20)),
});

export const AlertInput = z.object({
  symbol: z.string().max(30),
  targetPrice: z.number().finite().positive(),
  condition: z.enum(["above", "below"]),
});

export const ChartLessonInput = z.object({
  symbol: opt(z.string().max(30)),
  overallSignal: z.enum(["BUY", "SELL", "HOLD"]),
  confluenceScore: z.number().min(0).max(100),
  summary: z.string().max(3000),
  lesson: z.string().max(3000),
  patterns: z.array(z.string().max(80)).max(12),
  tags: z.array(z.string().max(40)).max(12),
  mistakes: z.array(z.string().max(400)).max(8).default([]),
  strengths: z.array(z.string().max(400)).max(8).default([]),
  charts: z.array(z.object({
    timeframe: z.enum(["15m", "1H", "4H", "1D"]),
    imageDataUrl: z.string().max(2_100_000),
    annotations: z.array(z.unknown()).max(40).default([]),
    signal: opt(z.enum(["BUY", "SELL", "HOLD"])),
    bias: opt(z.string().max(600)),
  })).min(1).max(3),
});

// ─── Paper trading (P4) ─────────────────────────────────────────────────────
const price = z.number().finite().positive();

export const PaperOrderInput = z.object({
  symbol: z.string().trim().min(1).max(30),
  side: z.enum(["LONG", "SHORT"]),
  margin: z.number().finite().positive().max(100_000_000),
  leverage: z.number().finite().min(1).max(20),
  stopLoss: opt(price),
  takeProfit: opt(price),
  signalId: opt(z.string().max(40)),
});

export const PaperExitsInput = z.object({
  stopLoss: price.nullable(),
  takeProfit: price.nullable(),
});

export const PaperResetInput = z.object({
  startingBalance: z.number().finite().min(100).max(10_000_000).default(10_000),
});

// ─── Agent trading sessions (P8) — the mandate itself is validated by lib/sessions/mandate.ts ───

export const SessionStartInput = z.object({
  name: opt(z.string().trim().max(80)),
  mandate: z.record(z.string(), z.unknown()),
  /** Must be exactly "LIVE" to start a real-money session. */
  confirmLive: opt(z.string().max(10)),
});

export const SessionControlInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("kill") }),
  z.object({ action: z.literal("extend"), minutes: z.number().int().min(5).max(1440) }),
  z.object({ action: z.literal("end"), mode: z.enum(["CLOSE_ALL", "KEEP_WITH_STOPS"]) }),
]);

export const SessionPositionInput = z.object({ action: z.enum(["close", "close_half", "breakeven"]) });

export const TradingLimitsInput = z.object({
  maxDailyLoss: z.number().finite().positive().max(10_000_000).nullable(),
  maxSessionsPerDay: z.number().int().min(1).max(100).nullable(),
});

export const ExchangeConnectionInput = z.object({
  provider: z.enum(["ccxt", "oanda"]).default("ccxt"),
  accountId: opt(z.string().trim().regex(/^[0-9A-Za-z-]{3,40}$/)),
  exchange: z.string().trim().toLowerCase().regex(/^[a-z0-9]{2,30}$/),
  label: opt(z.string().trim().max(60)),
  marketType: z.enum(["spot", "swap"]),
  quote: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/),
  sandbox: z.boolean(),
  apiKey: z.string().trim().min(4).max(512),
  /** OANDA uses a single token: the secret may be empty there. */
  secret: z.string().trim().max(4096),
  password: opt(z.string().max(512)),
  uid: opt(z.string().max(128)),
});
