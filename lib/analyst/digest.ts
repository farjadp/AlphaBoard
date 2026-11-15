import { fmtPrice } from "@/lib/format/number";

/**
 * The daily "today's zones" post (P18a): once each weekday morning, a plan with postToChannel lists its buy/sell
 * zones that are still live, how far price is from each, the zones waiting for a trigger and the open signals.
 * It is a watch list, not a signal: entries are still posted only when a trigger fires. Pure, so it is unit-tested.
 */

/** Weekdays, from this UTC hour (08:30 in Tehran) until DIGEST_LAST_HOUR_UTC, so a plan activated at night waits. */
export const DIGEST_HOUR_UTC = 5;
export const DIGEST_LAST_HOUR_UTC = 12;

export interface DigestZone {
  symbol: string;
  kind: "BUY" | "SELL" | "TARGET" | "INVALIDATION" | "INFO";
  low: number;
  high: number;
  direction: string | null;
  closeTf: string | null;
  state: string;
  signalState: string | null;
  triggerPrice: number | null;
  tpHit: number;
}

const SEP = "━━━━━━━━━━━━━━";
const FOOTER = "این‌ها سطح‌اند، نه سیگنال ورود. سیگنال فقط وقتی تریگر بیاید جداگانه پست می‌شود.";
const range = (z: { low: number; high: number }) => (z.low === z.high ? fmtPrice(z.low) : `${fmtPrice(z.low)} – ${fmtPrice(z.high)}`);
const side = (z: DigestZone) => (z.kind === "BUY" ? "🟢 زون خرید" : "🔴 زون فروش");

/** Where price is relative to a zone, in words and percent of price. */
function distance(z: { low: number; high: number }, price: number): string {
  if (price >= z.low && price <= z.high) return "قیمت داخل زون است";
  const edge = price < z.low ? z.low : z.high;
  const pct = Math.abs(edge - price) / price * 100;
  return `${pct < 0.1 ? "کمتر از ۰.۱" : Number(pct.toFixed(1))}٪ ${price < z.low ? "بالاتر" : "پایین‌تر"}`;
}

/** The UTC date key a digest is kept under, e.g. "2026-11-17". */
export const digestDay = (now: Date) => now.toISOString().slice(0, 10);

/** Whether a digest may go out at this moment: a weekday, inside the morning window. */
export function digestDue(now: Date): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  return day >= 1 && day <= 5 && hour >= DIGEST_HOUR_UTC && hour < DIGEST_LAST_HOUR_UTC;
}

/** Persian weekday and date in Tehran, e.g. "سه‌شنبه ۲۶ آبان". */
export const persianDate = (now: Date) =>
  new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Tehran" }).format(now);

/**
 * The post text, or null when the plan has nothing left to watch. `prices` are in the analyst's basis (feed minus
 * the plan's offset); a symbol without a price is listed without the distance.
 */
export function digestPost(zones: DigestZone[], prices: Record<string, number | null>, now: Date, username: string | null): string | null {
  const live = zones.filter((z) => (z.kind === "BUY" || z.kind === "SELL") && z.state === "WAITING");
  const waiting = zones.filter((z) => z.signalState === "WAITING_TRIGGER");
  const open = zones.filter((z) => z.signalState === "OPEN");
  if (live.length + waiting.length + open.length === 0) return null;

  const lines = [`📋 زون‌های امروز | ${persianDate(now)}`, SEP];
  const symbols = [...new Set(live.map((z) => z.symbol))].sort();
  for (const s of symbols) {
    const price = prices[s] ?? null;
    lines.push("", `▫️ ${s}${price != null ? ` — قیمت ${fmtPrice(price)}` : ""}`);
    const mine = live.filter((z) => z.symbol === s).sort((a, b) => b.high - a.high);
    for (const z of mine) lines.push(`${side(z)}: ${range(z)}${price != null ? ` (${distance(z, price)})` : ""}`);
    const cancels = zones.filter((z) => z.kind === "INVALIDATION" && z.symbol === s && z.state === "WAITING");
    for (const z of cancels) {
      const what = z.direction === "BELOW" ? "خرید" : "فروش";
      if (!mine.some((m) => (what === "خرید" ? m.kind === "BUY" : m.kind === "SELL"))) continue;
      lines.push(`❌ ابطال ${what}: کلوز ${z.closeTf ?? "4H"} ${z.direction === "BELOW" ? "زیر" : "بالای"} ${fmtPrice(z.low)}`);
    }
  }
  if (waiting.length) {
    lines.push("", "⏳ در زون، منتظر تریگر:");
    for (const z of waiting) lines.push(`   ${z.symbol} ${z.kind === "BUY" ? "زون خرید" : "زون فروش"} ${range(z)}`);
  }
  if (open.length) {
    lines.push("", "✅ سیگنال‌های باز:");
    for (const z of open) {
      const entry = z.triggerPrice != null ? ` از ${fmtPrice(z.triggerPrice)}` : "";
      const tp = z.tpHit > 0 ? ` — TP${z.tpHit} خورده، ریسک‌فری` : "";
      lines.push(`   ${z.kind === "BUY" ? "🟢 خرید" : "🔴 فروش"} ${z.symbol}${entry}${tp}`);
    }
  }
  lines.push(SEP, FOOTER, ...(username ? ["", `@${username.replace(/^@/, "")}`] : []));
  return lines.join("\n");
}
