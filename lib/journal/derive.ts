import type { JournalEntry } from "@/lib/types/userData";
import { computePnl } from "./pnl";

/**
 * Recompute status/PnL for a journal entry from its raw fields. Used on the server (source of
 * truth) and the client (optimistic UI). An exchange-reported PnL is never overwritten.
 */
export function withDerivedPnl(entry: JournalEntry): JournalEntry {
  const next = { ...entry };
  const exchangeLocked = next.pnlSource === "exchange" && typeof next.pnlPercent === "number";
  if (next.exitPrice && next.exitPrice > 0) {
    next.status = "CLOSED";
    const pnl = computePnl({
      entryPrice: next.entryPrice,
      exitPrice: next.exitPrice,
      position: next.position,
      leverage: next.leverage,
      feeRatePercent: next.feeRatePercent,
    });
    if (pnl) {
      next.grossPnlPercent = pnl.gross;
      if (!exchangeLocked) {
        next.pnlPercent = pnl.net;
        next.pnlSource = "calculated";
      }
    }
  } else if (exchangeLocked) {
    next.status = "CLOSED";
  }
  return next;
}
