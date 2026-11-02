import { fmtPrice } from "@/lib/format";
import type { NewNotification } from "@/lib/notify/notifications";
import { RISK_TEXT, type RiskLevel } from "./exits";
import type { ZoneKind } from "./zones";

/**
 * The in-app + Telegram text for an analyst-zone event (P18a), in Persian for the owner. Prices are in the
 * analyst's basis (the feed offset already removed), so they match the numbers the analysis wrote.
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
  /** The plan's invalidation level for this symbol, if any. */
  invalidation: MessageZone | null;
  trade?: TradeContext | null;
}

const range = (z: { low: number; high: number }) => (z.low === z.high ? fmtPrice(z.low) : `${fmtPrice(z.low)}–${fmtPrice(z.high)}`);
const breakText = (z: MessageZone) =>
  `کلوز ${z.closeTf ?? "4H"} ${z.direction === "BELOW" ? "پایین" : "بالای"} ${fmtPrice(z.direction === "BELOW" ? z.low : z.high)}`;
const FOOTER = "این فقط هشدار است؛ هیچ سفارشی ثبت نشده.";
const pctText = (n: number) => `${Number(n.toFixed(2))}%`;

/** Stop, targets and the risk line; the first target is where the stop moves to entry and profit is saved. */
function tradeLines(t: TradeContext): string[] {
  return [
    `حد ضرر: ${fmtPrice(t.stop)} (${pctText(t.stopPct)})`,
    ...t.targets.map((x, i) => `حد سود ${i + 1}: ${fmtPrice(x.price)} (${pctText(x.pct)})${i === 0 ? " — ریسک‌فری و سیو سود" : ""}`),
    `ریسک: ${RISK_TEXT[t.risk.level]}${t.risk.reasons.length ? ` — ${t.risk.reasons.join("، ")}` : ""}`,
  ];
}

export function zoneMessage(event: "ENTERED" | "HIT" | "BROKEN", z: MessageZone, ctx: MessageContext): NewNotification & { type: "analyst_zone" } {
  const data = { planId: ctx.planId, zoneId: z.id, symbol: z.symbol, price: ctx.price, href: "/admin/analyst" };
  if (event === "BROKEN") {
    return {
      type: "analyst_zone",
      title: `⛔ ${z.symbol}: سناریو باطل شد (${breakText(z)})`,
      body: [`منبع: ${ctx.source} · کلوز: ${fmtPrice(ctx.price)}`, "زون‌های دیگر این نماد در این پلن را با احتیاط ببینید."].join("\n"),
      data,
    };
  }
  const title = event === "HIT"
    ? `🎯 ${z.symbol} به تارگت ${range(z)} رسید`
    : `${z.kind === "BUY" ? "🟩" : "🟥"} ${z.symbol} وارد زون ${z.kind === "BUY" ? "خرید" : "فروش"} ${range(z)} شد`;
  const lines = [`منبع: ${ctx.source} · قیمت: ${fmtPrice(ctx.price)}`];
  if (ctx.agrees.length) lines.push(`هم‌نظر: ${ctx.agrees.join("، ")}`);
  if (event === "ENTERED") {
    if (z.condition) lines.push(`شرط ورود: ${z.condition}`);
    if (z.explain) lines.push(`توضیح: ${z.explain}`);
    if (ctx.trade) lines.push(...tradeLines(ctx.trade));
    if (ctx.invalidation) lines.push(`ابطال: ${breakText(ctx.invalidation)}`);
  }
  if (ctx.newsRisk) lines.push(`⚠️ ریسک خبر: ${ctx.newsRisk}`);
  lines.push(FOOTER);
  return { type: "analyst_zone", title, body: lines.join("\n"), data };
}

const CHANNEL_FOOTER = "این هشدارِ رسیدن قیمت به یک سطح است، نه سیگنال ورود. تصمیم و مدیریت ریسک با خودتان.";
const TRADE_FOOTER = "ورود فقط بعد از دیدن شرط ورود. حجم معامله و مدیریت ریسک با خودتان.";

/**
 * The public channel post for the same event: leaves out the owner's private context (source, agreeing sources,
 * the "no order was placed" note). Without exits it says plainly that it is not an entry signal; with them, that the
 * entry waits for the condition and sizing is the reader's own.
 */
export function channelMessage(event: "ENTERED" | "HIT" | "BROKEN", z: MessageZone, ctx: MessageContext, username: string | null): string {
  const m = zoneMessage(event, z, { ...ctx, agrees: [] });
  const body = m.body.split("\n").filter((l) => !l.startsWith("منبع:") && l !== FOOTER && !l.startsWith("زون‌های دیگر"));
  const price = event === "BROKEN" ? `کلوز: ${fmtPrice(ctx.price)}` : `قیمت: ${fmtPrice(ctx.price)}`;
  return [m.title, price, ...body, "", ctx.trade ? TRADE_FOOTER : CHANNEL_FOOTER, ...(username ? [`@${username.replace(/^@/, "")}`] : [])].join("\n");
}
