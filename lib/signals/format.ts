import { num } from "./wire";

/** Channel text for a Signal Desk signal (P12). Prices and R only; never account money. */
export interface PostView { symbol: string; side: "BUY" | "SELL"; entry: number | null; stop: number; tps: number[]; riskPct: number; note: string | null }

/** Broker symbol → the name readers know: "XAUUSD.ec" / "XAUUSDm" → "XAUUSD". */
export const displaySymbol = (symbol: string) => symbol.split(".")[0].replace(/[a-z]+$/, "");

const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x))}`;

export function formatSignalPost(s: PostView): string {
  const name = displaySymbol(s.symbol);
  const lines = [`${s.side === "BUY" ? "🟢 LONG" : "🔴 SHORT"} ${name}`];
  if (s.entry == null) {
    lines.push("Entry market", `Stop ${num(s.stop)}`);
  } else {
    lines.push(`Entry ${num(s.entry)}`, `Stop ${num(s.stop)} (${signed(s.stop - s.entry)})`);
  }
  if (s.tps.length) lines.push(`🎯 ${s.tps.map((tp, i) => `TP${i + 1} ${num(tp)}`).join(" · ")}`);
  const rr = s.entry != null && s.tps.length ? Math.round((Math.abs(s.tps[0] - s.entry) / Math.abs(s.entry - s.stop)) * 100) / 100 : null;
  lines.push(rr == null ? `Risk ${num(s.riskPct)}%` : `R:R to TP1 ${num(rr)} · risk ${num(s.riskPct)}%`);
  if (s.note) lines.push(s.note);
  lines.push(`#${name}`, "Not financial advice.");
  return lines.join("\n");
}
