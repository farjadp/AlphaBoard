import { fmtPrice } from "@/lib/format";
import type { NewNotification } from "@/lib/notify/notifications";
import { RISK_TEXT, type RiskLevel } from "./exits";
import type { ZoneKind } from "./zones";

/**
 * The texts for an analyst-zone event (P18a), in Persian: the owner's in-app + Telegram message, and the public
 * channel post. Prices are in the analyst's basis (the feed offset already removed), so they match the numbers
 * the analysis wrote. Telegram gets plain text, so the layout is built from lines, separators and emoji.
 */
export interface MessageZone {
  id: string;
  symbol: string;
  kind: ZoneKind;
  low: number;
  high: number;
  direction: string | null;
  closeTf: string | null;
  condition: string | null;
  /** Plain-language explanation of the condition (buy/sell zones). */
  explain?: string | null;
}

/** Stop, targets and risk for a buy/sell zone entry. Targets keep the plan's percents, in the same order. */
export interface TradeContext {
  stop: number;
  stopPct: number;
  targets: Array<{ price: number; pct: number }>;
  risk: { level: RiskLevel; reasons: string[] };
}

export interface MessageContext {
  planId: string;
  source: string;
  price: number;
  agrees: string[];
  newsRisk: string | null;
  /** The plan's invalidation level for this symbol that fits the zone's side, if any. */
  invalidation: MessageZone | null;
  trade?: TradeContext | null;
}

type ZoneEvent = "ENTERED" | "HIT" | "BROKEN";

const SEP = "━━━━━━━━━━━━━━";
const FOOTER = "این فقط هشدار است؛ هیچ سفارشی ثبت نشده.";
const CHANNEL_FOOTER = ["این هشدارِ رسیدن قیمت به یک سطح است، نه سیگنال ورود.", "تصمیم و مدیریت ریسک با خودتان."];
const TRADE_FOOTER = ["ورود فقط بعد از دیدن شرط ورود.", "حجم معامله و مدیریت ریسک با خودتان."];
const RISK_ICON: Record<RiskLevel, string> = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴" };

const range = (z: { low: number; high: number }) => (z.low === z.high ? fmtPrice(z.low) : `${fmtPrice(z.low)} – ${fmtPrice(z.high)}`);
const breakText = (z: MessageZone) =>
  `کلوز ${z.closeTf ?? "4H"} ${z.direction === "BELOW" ? "زیر" : "بالای"} ${fmtPrice(z.direction === "BELOW" ? z.low : z.high)}`;
const signed = (pct: number, sign: 1 | -1) => `${sign > 0 ? "+" : "-"}${Number(pct.toFixed(2))}%`;
const sideText = (z: MessageZone) => (z.kind === "BUY" ? "خرید" : "فروش");

/** The title shown in the notification list, and the header line of a post. */
function heading(event: ZoneEvent, z: MessageZone): { title: string; header: string } {
  if (event === "BROKEN") return { title: `⛔ ${z.symbol}: سناریو باطل شد`, header: `⛔ ${z.symbol} | سناریو باطل شد` };
  if (event === "HIT") return { title: `🎯 ${z.symbol} به تارگت ${range(z)} رسید`, header: `🎯 ${z.symbol} | تارگت خورد` };
  const dot = z.kind === "BUY" ? "🟢" : "🔴";
  return { title: `${dot} ${z.symbol} وارد زون ${sideText(z)} ${range(z)} شد`, header: `${dot} ${z.symbol} | ورود به زون ${sideText(z)}` };
}

/** The lines between the header and the footer, shared by the private message and the channel post. */
function details(event: ZoneEvent, z: MessageZone, ctx: MessageContext): string[] {
  if (event === "BROKEN") return [`❌ ${breakText(z)}`, `💵 کلوز: ${fmtPrice(ctx.price)}`, "⚠️ پوزیشن‌های باز این نماد را بازبینی کنید."];
  if (event === "HIT") return [`📍 تارگت: ${range(z)}`, `💵 قیمت: ${fmtPrice(ctx.price)}`];

  const lines = [`📍 ناحیه‌ی ورود: ${range(z)}`, `💵 قیمت الان: ${fmtPrice(ctx.price)}`];
  const t = ctx.trade;
  if (t) {
    const dir = z.kind === "BUY" ? 1 : -1;
    lines.push(
      "",
      ...t.targets.map((x, i) => `🎯 TP${i + 1}: ${fmtPrice(x.price)} (${signed(x.pct, dir)})${i === 0 ? " ✅ ریسک‌فری و سیو سود" : ""}`),
      `🛑 SL: ${fmtPrice(t.stop)} (${signed(t.stopPct, dir > 0 ? -1 : 1)})`,
    );
  }
  const notes: string[] = [];
  if (z.condition) notes.push(`⏳ شرط ورود: ${z.condition}`);
  if (z.explain) notes.push(`💡 ${z.explain}`);
  if (t) notes.push(`${RISK_ICON[t.risk.level]} ریسک: ${RISK_TEXT[t.risk.level]}`, ...t.risk.reasons.map((r) => `   ▫️ ${r}`));
  else if (ctx.newsRisk) notes.push(`⚠️ خبر مهم نزدیک است: ${ctx.newsRisk}`);
  if (ctx.invalidation) notes.push(`❌ ابطال: ${breakText(ctx.invalidation)}`);
  if (notes.length) lines.push(SEP, ...notes);
  return lines;
}

export function zoneMessage(event: ZoneEvent, z: MessageZone, ctx: MessageContext): NewNotification & { type: "analyst_zone" } {
  const who = [`📌 منبع: ${ctx.source}`, ...(ctx.agrees.length ? [`🤝 هم‌نظر: ${ctx.agrees.join("، ")}`] : [])];
  return {
    type: "analyst_zone",
    title: heading(event, z).title,
    body: [...who, ...details(event, z, ctx), "", FOOTER].join("\n"),
    data: { planId: ctx.planId, zoneId: z.id, symbol: z.symbol, price: ctx.price, href: "/admin/analyst" },
  };
}

/**
 * The public channel post: no source or agreeing sources, a separator under the header, and a footer that matches
 * what the post carries (an entry with exits waits for the condition; a bare level alert is not an entry signal).
 */
export function channelMessage(event: ZoneEvent, z: MessageZone, ctx: MessageContext, username: string | null): string {
  const footer = event === "ENTERED" ? (ctx.trade ? TRADE_FOOTER : CHANNEL_FOOTER) : [];
  return [
    heading(event, z).header,
    SEP,
    ...details(event, z, ctx),
    ...(footer.length ? ["", ...footer] : []),
    ...(username ? ["", `@${username.replace(/^@/, "")}`] : []),
  ].join("\n");
}
