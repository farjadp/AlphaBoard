/**
 * Where a position leaves the market on its own: liquidation, stop, target. Pure; shared by the paper
 * tick (candles) and the session monitor (candles since P14a, spot before). Same-bar stop and target →
 * the stop (conservative); a stop gapped through at the open fills at the open.
 */
import { dirOf } from "@/lib/trading/math";
import type { Bar, ExitReason, PositionLike, Side } from "./types";

/** Price at which the loss equals the margin (maintenance margin ignored). */
export function liquidationPrice(side: Side, entry: number, leverage: number): number {
  return side === "LONG" ? Math.max(0, entry * (1 - 1 / leverage)) : entry * (1 + 1 / leverage);
}

/** The level that fires first on the way against the position, and why. Null when nothing protects it. */
export function protectiveLevel(p: PositionLike): { level: number; reason: ExitReason } | null {
  const long = p.side === "LONG";
  const liq = liquidationPrice(p.side, p.entryPrice, p.leverage);
  const liqReal = long ? liq > 0 : true; // a 1× long cannot be liquidated; a 1× short can, at 2× the entry
  if (p.stopLoss == null) return liqReal ? { level: liq, reason: "LIQUIDATION" } : null;
  if (liqReal && (long ? p.stopLoss <= liq : p.stopLoss >= liq)) return { level: liq, reason: "LIQUIDATION" };
  return { level: p.stopLoss, reason: "STOP_LOSS" };
}

export interface ExitHit { reason: ExitReason; level: number; at: number }

/** First exit hit walking bars from `fromTime` (earlier bars are skipped: their extremes may predate the entry). */
export function scanExit(p: PositionLike, bars: Bar[], fromTime: number): ExitHit | null {
  const long = p.side === "LONG";
  const prot = protectiveLevel(p);
  for (const b of [...bars].filter((x) => x.time >= fromTime).sort((a, z) => a.time - z.time)) {
    if (prot) {
      const hit = long ? b.low <= prot.level : b.high >= prot.level;
      if (hit) {
        const gapped = long ? b.open < prot.level : b.open > prot.level;
        return { reason: prot.reason, level: gapped ? b.open : prot.level, at: b.time };
      }
    }
    if (p.takeProfit != null && (long ? b.high >= p.takeProfit : b.low <= p.takeProfit)) return { reason: "TAKE_PROFIT", level: p.takeProfit, at: b.time };
  }
  return null;
}

/**
 * Which exit a single price triggers (the 15 s monitor's spot check, and the paper tick's live quote).
 * `stopSlack` widens the stop by a fraction of its level: a stop resting on the exchange gets room to fire first.
 */
export function exitAtPrice(p: PositionLike, price: number, opts: { stopSlack?: number } = {}): ExitReason | null {
  const dir = dirOf(p.side);
  const slack = opts.stopSlack && p.stopLoss != null ? p.stopLoss * opts.stopSlack * -dir : 0;
  const prot = protectiveLevel({ ...p, stopLoss: p.stopLoss == null ? null : p.stopLoss + slack });
  if (prot && (dir > 0 ? price <= prot.level : price >= prot.level)) return prot.reason;
  if (p.takeProfit != null && (dir > 0 ? price >= p.takeProfit : price <= p.takeProfit)) return "TAKE_PROFIT";
  return null;
}
