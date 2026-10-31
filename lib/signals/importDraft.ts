import { canonicalTicker, matchBrokerSymbol } from "@/lib/market/symbols";
import { z } from "zod";
import { num } from "./num";

/**
 * "Paste a signal" (P12b): what the model reads from someone's post or screenshot, and the pure step that turns it
 * into a form draft for the Signal Desk. The draft is never sent by itself: the form shows it with warnings and
 * the owner presses Send. The model's output is untrusted, so every field is re-checked here.
 */
const toNumber = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const price = z.preprocess(toNumber, z.number().nullable()).default(null);

export const SignalExtractSchema = z.object({
  symbol: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 30) : null), z.string().nullable()).default(null),
  side: z.preprocess((v) => {
    const s = typeof v === "string" ? v.trim().toUpperCase() : "";
    return s === "BUY" || s === "LONG" ? "BUY" : s === "SELL" || s === "SHORT" ? "SELL" : null;
  }, z.enum(["BUY", "SELL"]).nullable()).default(null),
  market: z.preprocess((v) => v === true || v === "true", z.boolean()).default(false),
  entryLow: price,
  entryHigh: price,
  stop: price,
  targets: z.preprocess((v) => (Array.isArray(v) ? v.map(toNumber).filter((n): n is number => n != null) : []), z.array(z.number())).default([]),
  source: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null), z.string().nullable()).default(null),
});
export type SignalExtract = z.output<typeof SignalExtractSchema>;

const n = (t: "string" | "number" | "boolean") => ({ type: [t, "null"] });
/** Closed JSON Schema for schema-constrained providers; SignalExtractSchema stays the real validator. */
export const SIGNAL_EXTRACT_JSON = {
  type: "object",
  properties: {
    symbol: n("string"),
    side: { type: ["string", "null"], enum: ["BUY", "SELL", null] },
    market: { type: "boolean" },
    entryLow: n("number"),
    entryHigh: n("number"),
    stop: n("number"),
    targets: { type: "array", items: { type: "number" } },
    source: n("string"),
  },
  required: ["symbol", "side", "market", "entryLow", "entryHigh", "stop", "targets", "source"],
  additionalProperties: false,
} as const;

export const SIGNAL_EXTRACT_PROMPT = `Read the trading signal in this message or screenshot (it may be in Persian or English, from a Telegram channel).

Return ONLY a JSON object with these keys:
- "symbol": the instrument as written (e.g. "XAUUSD", "ETH/USDT", "GOLD"), or null.
- "side": "BUY" for buy/long/خرید, "SELL" for sell/short/فروش, or null when it is not stated.
- "market": true when the entry is "market"/"now"/مارکت with no price.
- "entryLow", "entryHigh": the entry price, or the two ends of an entry zone ("4080 - 4075" → 4075 and 4080). One price → the same number in both. null when market or missing.
- "stop": the stop loss (SL, Stoploss, حد ضرر), or null. Never invent one.
- "targets": take-profit prices in the order written (TP1, TP2, …, اهداف سود). A target written as a range ("4065_4075") counts as ONE target: use its first number. [] when none.
- "source": the channel or author name if it is visible, else null.

Read numbers exactly as printed. Ignore leverage, margin, profit claims, images of charts and disclaimers. If something is unclear, use null rather than guessing.`;

/** The terminal symbol for a symbol as written in a post (USDT and USD count as the same quote), or null. */
export const matchSymbol = matchBrokerSymbol;

export interface SignalDraft {
  symbol: string;
  side: "BUY" | "SELL" | null;
  entry: number | null;
  stop: number | null;
  tps: number[];
  maxDeviation: number | null;
  source: string | null;
}

const MAX_TPS = 4;

/** Model output → form draft plus plain-language warnings about anything it had to decide. */
export function draftFromExtract(x: SignalExtract, symbols: string[]): { draft: SignalDraft; warnings: string[] } {
  const warnings: string[] = [];
  const matched = x.symbol ? matchSymbol(x.symbol, symbols) : null;
  const symbol = matched ?? (x.symbol ? canonicalTicker(x.symbol) : "");
  if (!symbol) warnings.push("No symbol found: pick one");
  else if (!matched) warnings.push(`${symbol} is not in your terminal's symbol list`);

  const lo = x.market ? null : x.entryLow ?? x.entryHigh;
  const hi = x.market ? null : x.entryHigh ?? x.entryLow;
  const entry = lo != null && hi != null ? Number(((lo + hi) / 2).toPrecision(10)) : null;

  let side = x.side;
  if (!side) {
    const ref = entry ?? x.targets[0] ?? null;
    if (x.stop != null && ref != null && ref !== x.stop) {
      side = ref > x.stop ? "BUY" : "SELL";
      warnings.push(`Side was not stated; read as ${side} from the stop and targets`);
    } else warnings.push("Side was not stated: choose Long or Short");
  }
  if (x.stop == null) warnings.push("No stop loss in the source: set one before sending");

  let maxDeviation: number | null = null;
  if (entry != null && lo != null && hi != null) {
    const half = Math.abs(hi - lo) / 2;
    const quarterStop = x.stop != null ? Math.abs(entry - x.stop) * 0.25 : 0;
    const dev = Math.max(half, quarterStop);
    if (dev > 0) maxDeviation = Number(dev.toPrecision(3));
    if (lo !== hi) warnings.push(`Entry zone ${num(Math.min(lo, hi))}–${num(Math.max(lo, hi))}: entry set to the middle (${num(entry)}); the terminal accepts a fill up to ${maxDeviation == null ? "the default" : num(maxDeviation)} away`);
  }

  let tps = [...new Set(x.targets)];
  if (side) {
    const dir = side === "BUY" ? 1 : -1;
    const ref = entry ?? x.stop;
    const kept = ref == null ? tps : tps.filter((t) => (t - ref) * dir > 0);
    if (kept.length < tps.length) warnings.push(`Dropped ${tps.length - kept.length} target${tps.length - kept.length > 1 ? "s" : ""} on the wrong side of the ${entry != null ? "entry" : "stop"}`);
    tps = kept.sort((a, b) => (a - b) * dir);
  }
  if (tps.length > MAX_TPS) {
    warnings.push(`${x.targets.length} targets found; kept the first ${MAX_TPS}`);
    tps = tps.slice(0, MAX_TPS);
  }

  return { draft: { symbol, side, entry, stop: x.stop, tps, maxDeviation, source: x.source }, warnings };
}
