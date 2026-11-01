import { stripBrokerSuffix } from "@/lib/market/symbols";
import { num } from "./num";

/**
 * Channel text for a Signal Desk signal (P12), from an editable template (Admin → Signals → Post template).
 * Prices and R only; never account money. A line whose fields all come out empty is dropped, so optional parts
 * ({note}, {rr}) disappear cleanly.
 */
export interface PostView { symbol: string; side: "BUY" | "SELL"; entry: number | null; stop: number; tps: number[]; riskPct: number; note: string | null }

/** Broker symbol → the name readers know: "XAUUSD.ec" / "XAUUSDm" → "XAUUSD". */
export const displaySymbol = stripBrokerSuffix;

export const DEFAULT_POST_TEMPLATE = [
  "{symbol}",
  "{sideEmoji} {side} Position",
  "",
  "Entry: {entry}",
  "",
  "🔥 Risk: {risk}%",
  "⛔️ Stop-Loss: {stop}",
  "",
  "TARGETS:",
  "{targets}",
  "",
  "{note}",
  "----",
  "پیشنهاد سرمایه گذاری نیست. ما سیگنال فروش نیستیم. این دیتا مستقیما از تریدهای خودمان توسط ربات به کانال {channel} ارسال میشود",
].join("\n");

export const TEMPLATE_FIELDS = {
  symbol: "Symbol without the broker suffix (XAUUSD)",
  side: "Long or Short",
  sideEmoji: "🟢 for a long, 🔴 for a short",
  entry: "Entry price, or Market",
  stop: "Stop-loss price",
  stopDistance: "Stop distance from the entry, signed (−12.4)",
  risk: "Risk % of balance (0.5)",
  targets: "One line per target: 🎯 TP1: 2656",
  rr: "Reward:risk to TP1 (0.45)",
  note: "Your note for this signal",
  hashtag: "#XAUUSD",
  channel: "@ your channel username",
} as const;
type Field = keyof typeof TEMPLATE_FIELDS;

const FIELD = /\{([A-Za-z]+)\}/g;
const MAX_TEMPLATE = 2_000;
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x))}`;

function values(s: PostView, channel: string | null): Record<Field, string> {
  const name = displaySymbol(s.symbol);
  const rr = s.entry != null && s.tps.length ? Math.round((Math.abs(s.tps[0] - s.entry) / Math.abs(s.entry - s.stop)) * 100) / 100 : null;
  return {
    symbol: name,
    side: s.side === "BUY" ? "Long" : "Short",
    sideEmoji: s.side === "BUY" ? "🟢" : "🔴",
    entry: s.entry == null ? "Market" : num(s.entry),
    stop: num(s.stop),
    stopDistance: s.entry == null ? "" : signed(s.stop - s.entry),
    risk: num(s.riskPct),
    targets: s.tps.map((tp, i) => `🎯 TP${i + 1}: ${num(tp)}`).join("\n"),
    rr: rr == null || !Number.isFinite(rr) ? "" : num(rr),
    note: s.note?.trim() ?? "",
    hashtag: `#${name}`,
    channel: channel ? `@${channel.replace(/^@/, "")}` : "",
  };
}

export function renderPost(template: string, s: PostView, channel: string | null): string {
  const v = values(s, channel);
  const lines: string[] = [];
  for (const line of template.replace(/\r\n/g, "\n").split("\n")) {
    const used = [...line.matchAll(FIELD)].map((m) => m[1]).filter((f): f is Field => f in v);
    if (used.length && used.every((f) => v[f] === "")) continue;
    lines.push(line.replace(FIELD, (all, f: string) => (f in v ? v[f as Field] : all)));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const formatSignalPost = (s: PostView, template: string = DEFAULT_POST_TEMPLATE, channel: string | null = null) => renderPost(template, s, channel);

/** Why a template cannot be saved; [] when it is fine. */
export function templateProblems(template: string): string[] {
  const errs: string[] = [];
  const used = new Set([...template.matchAll(FIELD)].map((m) => m[1]));
  for (const f of used) if (!(f in TEMPLATE_FIELDS)) errs.push(`Unknown field {${f}}`);
  if (!used.has("symbol")) errs.push("The template needs {symbol}");
  if (!used.has("side") && !used.has("sideEmoji")) errs.push("The template needs {side} or {sideEmoji}");
  if (!used.has("stop")) errs.push("The template needs {stop}");
  if (template.length > MAX_TEMPLATE) errs.push(`The template is too long (max ${MAX_TEMPLATE} characters)`);
  return errs;
}
