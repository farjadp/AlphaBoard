export type TradePosition = "LONG" | "SHORT" | "SPOT";

/** Default taker fee per side (Binance/Bybit futures ≈ 0.05%). Round-trip cost = 2 × this × leverage. */
export const DEFAULT_FEE_RATE_PERCENT = 0.05;

/**
 * Net PnL as % of margin after round-trip taker fees.
 * Returns null for non-positive prices (v1 returned Infinity for an entry of 0).
 */
export function computePnl(params: {
  entryPrice: number;
  exitPrice: number;
  position: TradePosition;
  leverage?: number;
  feeRatePercent?: number;
}): { gross: number; net: number; feeImpact: number } | null {
  const { entryPrice, exitPrice, position, leverage, feeRatePercent } = params;
  if (!(entryPrice > 0) || !(exitPrice > 0)) return null;
  const feeRate = typeof feeRatePercent === "number" && feeRatePercent >= 0 ? feeRatePercent : DEFAULT_FEE_RATE_PERCENT;
  const lev = leverage && leverage > 0 ? leverage : 1;
  const move = ((exitPrice - entryPrice) / entryPrice) * 100;
  const gross = (position === "SHORT" ? -move : move) * lev;
  const feeImpact = feeRate * 2 * lev;
  return { gross, net: gross - feeImpact, feeImpact };
}
