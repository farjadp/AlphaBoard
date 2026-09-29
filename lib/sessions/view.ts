import "server-only";
import type { SessionPosition, TradingSession } from "@prisma/client";
import { markPosition } from "@/lib/paper/engine";
import type { PriceOf } from "@/lib/paper/account";
import type { SessionPositionDto, SessionSummaryDto, SessionViewDto } from "@/lib/types/sessions";
import type { Mandate } from "./mandate";

export const mandateOf = (s: Pick<TradingSession, "mandate">) => s.mandate as unknown as Mandate;

interface PlanJson { thesis?: string; invalidation?: string; horizonMin?: number }
const planOf = (p: Pick<SessionPosition, "exitPlan">) => (p.exitPlan ?? {}) as PlanJson;

/** Live marks for open positions; unrealized is null for a position without a price. */
export async function markOpen(positions: SessionPosition[], priceOf: PriceOf) {
  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const prices = new Map(await Promise.all(symbols.map(async (s) => [s, await priceOf(s).catch(() => null)] as const)));
  return positions.map((p) => {
    const mark = prices.get(p.symbol) ?? null;
    return { pos: p, mark, unrealized: mark == null ? null : markPosition(p, mark) };
  });
}

/**
 * Session money: net = realized − fees (+ unrealized when every open position has a price).
 * lossUsed is the positive loss against the mandate's loss limit, null if a price is missing.
 */
export function sessionMoney(s: Pick<TradingSession, "capital" | "realizedPnl" | "fees">, marks: Array<{ unrealized: number | null }>) {
  const realizedNet = s.realizedPnl - s.fees;
  const missing = marks.some((m) => m.unrealized == null);
  const unrealized = missing ? null : marks.reduce((a, m) => a + (m.unrealized ?? 0), 0);
  const net = unrealized == null ? null : realizedNet + unrealized;
  return { realizedNet, unrealized, equity: net == null ? null : s.capital + net, lossUsed: net == null ? null : Math.max(0, -net) };
}

export function positionToDto(p: SessionPosition, mark: number | null = null, unrealized: number | null = null): SessionPositionDto {
  const plan = planOf(p);
  return {
    id: p.id, symbol: p.symbol, side: p.side, qty: p.qty, entryPrice: p.entryPrice, leverage: p.leverage, margin: p.margin,
    stopLoss: p.stopLoss, takeProfit: p.takeProfit, thesis: plan.thesis ?? "", invalidation: plan.invalidation ?? "", horizonMin: plan.horizonMin ?? 0,
    fees: p.fees, openedAt: p.openedAt.toISOString(), markPrice: p.closedAt ? null : mark, unrealizedPnl: p.closedAt ? null : unrealized,
    closedAt: p.closedAt?.toISOString() ?? null, closePrice: p.closePrice, realizedPnl: p.realizedPnl, closeReason: p.closeReason,
  };
}

export function summaryToDto(s: TradingSession, openPositions: number): SessionSummaryDto {
  const m = mandateOf(s);
  return {
    id: s.id, name: s.name, status: s.status, live: s.live, venue: s.venue, marketType: m.marketType, symbols: m.symbols, capital: s.capital,
    startedAt: s.startedAt.toISOString(), endsAt: s.endsAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null, endReason: s.endReason,
    netPnl: s.realizedPnl - s.fees, llmCostUsd: s.llmCostUsd, tradesCount: s.tradesCount, openPositions,
  };
}

export async function buildView(s: TradingSession & { positions: SessionPosition[]; report: { id: string } | null }, priceOf: PriceOf, now = new Date()): Promise<SessionViewDto> {
  const m = mandateOf(s);
  const open = s.positions.filter((p) => !p.closedAt);
  const closed = s.positions.filter((p) => p.closedAt).sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime());
  const marks = await markOpen(open, priceOf);
  const money = sessionMoney(s, marks);
  return {
    ...summaryToDto(s, open.length),
    mandate: m,
    realizedPnl: s.realizedPnl,
    fees: s.fees,
    unrealizedPnl: money.unrealized,
    equity: money.equity,
    meters: {
      timeLeftMs: Math.max(0, s.endsAt.getTime() - now.getTime()),
      lossUsed: money.lossUsed, lossLimit: m.lossLimit,
      trades: s.tradesCount, maxTrades: m.maxTrades,
      openPositions: open.length, maxOpenPositions: m.maxOpenPositions,
      llmCostUsd: s.llmCostUsd, maxLlmCostUsd: m.maxLlmCostUsd,
    },
    cycleCount: s.cycleCount,
    nextCycleAt: s.nextCycleAt?.toISOString() ?? null,
    llmBudgetHit: s.llmBudgetHit,
    extension: s.status === "AWAITING_EXTENSION" && s.extensionPromptAt
      ? { promptedAt: s.extensionPromptAt.toISOString(), deadline: new Date(s.extensionPromptAt.getTime() + m.extensionTimeoutMin * 60_000).toISOString() }
      : null,
    positions: marks.map((x) => positionToDto(x.pos, x.mark, x.unrealized)),
    closedPositions: closed.map((p) => positionToDto(p)),
    hasReport: !!s.report,
  };
}
