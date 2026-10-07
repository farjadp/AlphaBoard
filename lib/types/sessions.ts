/** Trading-session DTOs shared by the API and the client. Nullable numbers mean "unavailable", never zero. */
import type { Mandate } from "@/lib/sessions/mandate";

export type SessionStatus = "RUNNING" | "PAUSED" | "AWAITING_EXTENSION" | "ENDING" | "ENDED" | "HALTED";
export type SessionRole = "MARKET" | "NEWS" | "BULL" | "BEAR" | "STRATEGIST" | "RISK" | "EXECUTOR" | "JOURNAL" | "SYSTEM" | "USER";
export type SessionMessageKind = "TEXT" | "PROPOSAL" | "VERDICT" | "ORDER" | "FILL" | "ALERT" | "REPORT";

export interface SessionSummaryDto {
  id: string;
  name: string;
  status: SessionStatus;
  live: boolean;
  venue: string;
  marketType: "spot" | "swap";
  symbols: string[];
  capital: number;
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
  endReason: string | null;
  /** Realized P&L net of fees. */
  netPnl: number;
  llmCostUsd: number;
  tradesCount: number;
  openPositions: number;
}

export interface SessionPositionDto {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  stopLoss: number | null;
  takeProfit: number | null;
  thesis: string;
  invalidation: string;
  horizonMin: number;
  fees: number;
  openedAt: string;
  markPrice: number | null;
  unrealizedPnl: number | null;
  closedAt: string | null;
  closePrice: number | null;
  realizedPnl: number | null;
  closeReason: string | null;
}

export interface SessionViewDto extends SessionSummaryDto {
  mandate: Mandate;
  realizedPnl: number;
  fees: number;
  unrealizedPnl: number | null;
  equity: number | null;
  meters: {
    timeLeftMs: number;
    lossUsed: number | null;
    lossLimit: number;
    trades: number;
    maxTrades: number;
    openPositions: number;
    maxOpenPositions: number;
    llmCostUsd: number;
    maxLlmCostUsd: number;
  };
  cycleCount: number;
  nextCycleAt: string | null;
  llmBudgetHit: boolean;
  extension: { promptedAt: string; deadline: string } | null;
  positions: SessionPositionDto[];
  closedPositions: SessionPositionDto[];
  hasReport: boolean;
}

export interface SessionMessageDto {
  id: string;
  role: SessionRole;
  kind: SessionMessageKind;
  body: string;
  data: unknown;
  costUsd: number | null;
  cycle: number | null;
  createdAt: string;
}

export interface SessionReportDto {
  summary: string;
  lessons: string[];
  metrics: SessionMetrics;
  createdAt: string;
}

export interface SessionMetrics {
  capital: number;
  netPnl: number;
  grossPnl: number;
  fees: number;
  llmCostUsd: number;
  /** Currency of the P&L figures (absent on reports written before P10). */
  accountCurrency?: string | null;
  /** Net P&L minus AI cost — null when the account is not in USD (AI is billed in USD). */
  netAfterLlm: number | null;
  returnPct: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  expectancyR: number | null;
  maxDrawdown: number;
  buyAndHold: { symbol: string; startPrice: number; endPrice: number; returnPct: number } | null;
  rejections: Array<{ reason: string; count: number }>;
  durationMin: number;
  cycles: number;
}

export interface DailyUsageDto {
  sessionsToday: number;
  lossToday: number;
  limits: { maxDailyLoss: number | null; maxSessionsPerDay: number | null };
}
