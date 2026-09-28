import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { modelFamily, performanceReport, type EvaluatedRow } from "./metrics";

export interface PerformanceFilters {
  symbol?: string;
  timeframe?: string;
  /** Model family: dated snapshots ("…-2026-03-17") count as the same model. */
  model?: string;
  /** Signals created in the last N days; omitted = all time. */
  days?: number;
}

/** The user's signal performance, with filter options drawn from their own signals. */
export async function userPerformance(userId: string, f: PerformanceFilters = {}, now = new Date()) {
  const own: Prisma.SignalWhereInput = { userId, signal: { in: ["BUY", "SELL"] } };
  const where: Prisma.SignalWhereInput = {
    ...own,
    ...(f.symbol ? { symbol: f.symbol } : {}),
    ...(f.timeframe ? { timeframe: f.timeframe } : {}),
    ...(f.days ? { createdAt: { gte: new Date(now.getTime() - f.days * 86_400_000) } } : {}),
  };
  const [signals, options, holds] = await Promise.all([
    prisma.signal.findMany({
      where, orderBy: { createdAt: "desc" }, take: 5_000,
      select: { id: true, symbol: true, timeframe: true, signal: true, confidence: true, model: true, createdAt: true, entry: true, stopLoss: true, takeProfit: true, evaluation: true },
    }),
    prisma.signal.findMany({ where: own, distinct: ["symbol", "timeframe", "model"], select: { symbol: true, timeframe: true, model: true }, take: 1_000 }),
    prisma.signal.count({ where: { ...where, signal: "HOLD" } }), // HOLDs are not model-filtered: they are only a count
  ]);

  const matching = f.model ? signals.filter((s) => modelFamily(s.model) === f.model) : signals;
  const rows: EvaluatedRow[] = matching.map((s) => ({
    status: s.evaluation?.status ?? "OPEN",
    rMultiple: s.evaluation?.rMultiple ?? null,
    resolvedAt: s.evaluation?.resolvedAt ?? null,
    confidence: s.confidence, symbol: s.symbol, timeframe: s.timeframe, model: s.model,
  }));
  const uniq = (xs: string[]) => [...new Set(xs)].sort();

  return {
    filters: f,
    options: { symbols: uniq(options.map((o) => o.symbol)), timeframes: uniq(options.map((o) => o.timeframe)), models: uniq(options.map((o) => modelFamily(o.model))) },
    holds,
    ...performanceReport(rows),
    recent: matching.slice(0, 50).map((s) => ({
      id: s.id, symbol: s.symbol, timeframe: s.timeframe, signal: s.signal, confidence: s.confidence, model: s.model,
      createdAt: s.createdAt.toISOString(), entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit,
      status: s.evaluation?.status ?? "OPEN", rMultiple: s.evaluation?.rMultiple ?? null,
      resolvedAt: s.evaluation?.resolvedAt?.toISOString() ?? null, note: s.evaluation?.note ?? null,
    })),
  };
}

export type UserPerformance = Awaited<ReturnType<typeof userPerformance>>;
