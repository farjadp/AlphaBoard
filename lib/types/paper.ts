/** Paper-trading DTOs shared by the API and the client. Nullable numbers mean "unavailable", never zero. */
export type PaperSide = "LONG" | "SHORT";
export type PaperCloseReason = "MANUAL" | "STOP_LOSS" | "TAKE_PROFIT" | "LIQUIDATION";

export interface PaperPositionDto {
  id: string;
  symbol: string;
  side: PaperSide;
  qty: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  stopLoss: number | null;
  takeProfit: number | null;
  liquidationPrice: number;
  signalId: string | null;
  fees: number;
  openedAt: string;
  /** Open positions only. */
  markPrice: number | null;
  unrealizedPnl: number | null;
  /** Closed positions only. */
  closedAt: string | null;
  closePrice: number | null;
  realizedPnl: number | null;
  closeReason: PaperCloseReason | null;
}

export interface PaperOrderDto {
  id: string;
  positionId: string | null;
  symbol: string;
  action: "BUY" | "SELL";
  qty: number;
  requestedPrice: number;
  fillPrice: number;
  fee: number;
  reason: string | null;
  createdAt: string;
}

export interface PaperAccountDto {
  startingBalance: number;
  cash: number;
  currency: string;
  createdAt: string;
  resetAt: string | null;
  usedMargin: number;
  unrealizedPnl: number | null;
  realizedPnl: number;
  equity: number | null;
  returnPct: number | null;
  closedCount: number;
  winCount: number;
}

export interface PaperOverview {
  account: PaperAccountDto;
  positions: PaperPositionDto[];
  history: PaperPositionDto[];
  orders: PaperOrderDto[];
  equityCurve: Array<{ at: string; equity: number }>;
}
