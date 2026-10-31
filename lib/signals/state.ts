import { rMultiple } from "@/lib/trading/math";
import { num } from "./num";
import type { ReportEvent } from "./wire";

/**
 * Signal Desk state machine (P12): one EA report → the signal's next status, the leg change and the channel reply.
 * Pure and idempotent: a repeated report (the EA retries failed sends) changes nothing and posts nothing.
 * Every leg shares the signal's original stop, so R = (close − open) · side / |open − stop|.
 */
export interface LegView { leg: number; status: "OPEN" | "TP" | "SL" | "CLOSED"; openPrice: number; volume: number; r: number | null }
export interface SignalView { status: string; side: "BUY" | "SELL"; stop: number; legs: LegView[]; breakevenDone: boolean }
export interface Transition {
  status: string;
  reason?: string;
  legCreate?: { leg: number; ticket: string; volume: number; openPrice: number; tp: number | null };
  legUpdate?: { leg: number; status: "TP" | "SL" | "CLOSED"; closePrice: number; r: number };
  breakeven?: true;
  reply: string | null;
}

const FINAL = new Set(["CLOSED", "REJECTED", "EXPIRED", "CANCELLED"]);
/** |R| below this is "at entry". */
const FLAT_R = 0.05;

const round2 = (x: number) => Math.round(x * 100) / 100 || 0;
export const fmtR = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${num(Math.abs(r))}R`;

function rOf(s: SignalView, openPrice: number, closePrice: number) {
  return round2(rMultiple({ side: s.side, entry: openPrice, stop: s.stop, price: closePrice }) ?? 0);
}

function legLine(e: { event: "TP" | "SL" | "CLOSED"; leg: number; price: number }, r: number) {
  if (e.event === "TP") return `🎯 TP${e.leg} reached ${num(e.price)} (${fmtR(r)})`;
  if (e.event === "CLOSED") return `✅ Closed at ${num(e.price)}`;
  if (Math.abs(r) < FLAT_R) return "⚖️ Stopped at entry (0R)";
  return r < 0 ? `🛑 Stop hit (${fmtR(r)})` : `🔒 Stopped in profit (${fmtR(r)})`;
}

export function applyReport(s: SignalView, e: ReportEvent): Transition {
  const same: Transition = { status: s.status, reply: null };
  if (FINAL.has(s.status)) return same;

  switch (e.event) {
    case "FILLED":
      if (s.legs.some((l) => l.leg === e.leg)) return same;
      return { status: "OPEN", legCreate: { leg: e.leg, ticket: e.ticket, volume: e.volume, openPrice: e.price, tp: e.tp }, reply: null };
    case "REJECTED":
      return s.legs.length ? { status: s.status, reason: `partly rejected: ${e.reason}`, reply: null } : { status: "REJECTED", reason: e.reason, reply: null };
    case "DRY_RUN":
      return s.legs.length ? same : { status: "CLOSED", reason: `dry run: ${e.reason}`, reply: null };
    case "BE":
      return s.breakevenDone ? same : { status: s.status, breakeven: true, reply: "🔒 Stop moved to entry" };
  }

  const leg = s.legs.find((l) => l.leg === e.leg);
  if (!leg || leg.status !== "OPEN") return same;
  const r = rOf(s, leg.openPrice, e.price);
  const legUpdate = { leg: e.leg, status: e.event, closePrice: e.price, r };
  const legs = s.legs.map((l) => (l.leg === e.leg ? { ...l, status: e.event, r } : l));

  if (legs.some((l) => l.status === "OPEN")) {
    // All legs share one stop and a close-all closes every leg: only a TP is news before the last leg.
    return { status: s.status, legUpdate, reply: e.event === "TP" ? legLine(e, r) : null };
  }
  const volume = legs.reduce((a, l) => a + l.volume, 0);
  const result = round2(legs.reduce((a, l) => a + (l.r ?? 0) * l.volume, 0) / volume);
  const lines = [legLine(e, r)];
  if (legs.every((l) => l.status === "TP")) lines.push("🏁 All targets reached");
  lines.push(`Result ${fmtR(result)}`);
  return { status: "CLOSED", legUpdate, reply: lines.join("\n") };
}
