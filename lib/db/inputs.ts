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
