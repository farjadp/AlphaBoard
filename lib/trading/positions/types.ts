export type Side = "LONG" | "SHORT";
export type ExitReason = "STOP_LOSS" | "TAKE_PROFIT" | "LIQUIDATION";

export interface Bar { time: number; open: number; high: number; low: number; close: number }

/** The fields every position world (paper, session, MT5 leg) can supply. Null = unknown, never 0. */
export interface PositionLike {
  side: Side;
  entryPrice: number;
  leverage: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface TrackedPosition extends PositionLike {
  /** The stop at entry; R is measured against it, not against a later tightened stop. */
  initialStop?: number | null;
  bestPrice?: number | null;
  worstPrice?: number | null;
}
