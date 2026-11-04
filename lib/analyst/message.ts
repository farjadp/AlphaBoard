import { fmtPrice } from "@/lib/format";
import type { NewNotification } from "@/lib/notify/notifications";
import { RISK_TEXT, type RiskLevel } from "./exits";
import { LOOKBACK, TRIGGER_TEXT, type TriggerTf } from "./trigger";
import type { ZoneKind } from "./zones";

/**
 * Texts for analyst-zone events (P18a), in Persian. The owner gets every step in-app + Telegram: zone reached
 * (wait for the trigger), trigger fired (enter now), then targets, stop, breakeven. The public channel gets only
 * the signal when the trigger fires, and every later step as a reply under it. Prices are in the analyst's basis.
 * Telegram gets plain text, so the layout is lines, separators and emoji.
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
  explain?: string | null;
}

export interface MessageContext {
  planId: string;
  source: string;
  price: number;
  agrees: string[];
  newsRisk: string | null;
  /** The plan's invalidation level for this symbol that fits the zone's side, if any. */
  invalidation: MessageZone | null;
  triggerTf?: TriggerTf;
}

/** A signal: entry at the trigger, exits as percents of it, and the rule-based risk. */
export interface SignalInfo {
  entry: number;
  stop: number;
  stopPct: number;
  targets: Array<{ price: number; pct: number }>;
  risk: { level: RiskLevel; reasons: string[] };
  triggerTf: TriggerTf;
}

export type SignalStep =
  | { kind: "TP"; index: number }
  | { kind: "STOP" }
  | { kind: "BREAKEVEN" }
  | { kind: "ALL_TP" }
  | { kind: "BROKEN"; level: MessageZone }
  | { kind: "TIMEOUT"; days: number };

const SEP = "━━━━━━━━━━━━━━";
const FOOTER = "این فقط هشدار است؛ هیچ سفارشی ثبت نشده.";
const SIGNAL_FOOTER = "حجم معامله و مدیریت ریسک با خودتان.";
const RISK_ICON: Record<RiskLevel, string> = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴" };

const range = (z: { low: number; high: number }) => (z.low === z.high ? fmtPrice(z.low) : `${fmtPrice(z.low)} – ${fmtPrice(z.high)}`);
const breakText = (z: MessageZone) =>
  `کلوز ${z.closeTf ?? "4H"} ${z.direction === "BELOW" ? "زیر" : "بالای"} ${fmtPrice(z.direction === "BELOW" ? z.low : z.high)}`;
const signed = (pct: number, sign: 1 | -1) => `${sign > 0 ? "+" : "-"}${Number(pct.toFixed(2))}%`;
const isBuy = (z: MessageZone) => z.kind === "BUY";
const sideText = (z: MessageZone) => (isBuy(z) ? "خرید" : "فروش");
const dot = (z: MessageZone) => (isBuy(z) ? "🟢" : "🔴");
/** The trigger rule in words, so a reader knows what the system waits for. */
export const triggerRule = (z: MessageZone, tf: TriggerTf) =>
  `${isBuy(z) ? "کلوز بالای سقف" : "کلوز زیر کف"} ${LOOKBACK} کندل ${TRIGGER_TEXT[tf]} قبلی، بدون شکست زون`;
const handle = (u: string | null) => (u ? ["", `@${u.replace(/^@/, "")}`] : []);
const who = (ctx: { source: string; agrees: string[] }) => [`📌 منبع: ${ctx.source}`, ...(ctx.agrees.length ? [`🤝 هم‌نظر: ${ctx.agrees.join("، ")}`] : [])];
const data = (planId: string, z: MessageZone, price: number) => ({ planId, zoneId: z.id, symbol: z.symbol, price, href: "/admin/analyst" });

/** Entry, TPs then SL, risk and invalidation: the body of a signal, private or public. */
function signalLines(z: MessageZone, s: SignalInfo, invalidation: MessageZone | null): string[] {
  const dir = isBuy(z) ? 1 : -1;
  return [
    `💵 ورود: ${fmtPrice(s.entry)}`,
    "",
    ...s.targets.map((x, i) => `🎯 TP${i + 1}: ${fmtPrice(x.price)} (${signed(x.pct, dir)})${i === 0 ? " ✅ ریسک‌فری و سیو سود" : ""}`),
    `🛑 SL: ${fmtPrice(s.stop)} (${signed(s.stopPct, dir > 0 ? -1 : 1)})`,
    SEP,
    `⚡ تریگر: ${triggerRule(z, s.triggerTf)}`,
    `📍 زون: ${range(z)}`,
    `${RISK_ICON[s.risk.level]} ریسک: ${RISK_TEXT[s.risk.level]}`,
    ...s.risk.reasons.map((r) => `   ▫️ ${r}`),
    ...(invalidation ? [`❌ ابطال: ${breakText(invalidation)}`] : []),
  ];
}

/** Zone reached, analyst target reached, or scenario broken: owner only. */
export function zoneMessage(event: "ENTERED" | "HIT" | "BROKEN", z: MessageZone, ctx: MessageContext): NewNotification & { type: "analyst_zone" } {
  let title: string;
  let lines: string[];
  if (event === "BROKEN") {
    title = `⛔ ${z.symbol}: سناریو باطل شد`;
    lines = [`❌ ${breakText(z)}`, `💵 کلوز: ${fmtPrice(ctx.price)}`, "⚠️ پوزیشن‌های باز این نماد را بازبینی کنید."];
  } else if (event === "HIT") {
    title = `🎯 ${z.symbol} به تارگت تحلیل ${range(z)} رسید`;
    lines = [`💵 قیمت: ${fmtPrice(ctx.price)}`, "این تارگتِ خودِ تحلیل است؛ اگر سیگنالی از این پلن باز نیست، کاری لازم نیست."];
  } else {
    title = `⏳ ${z.symbol} وارد زون ${sideText(z)} ${range(z)} شد — منتظر تریگر`;
    lines = [
      `💵 قیمت الان: ${fmtPrice(ctx.price)}`,
      ...(ctx.triggerTf ? [`⚡ تریگر سیستم: ${triggerRule(z, ctx.triggerTf)}`] : []),
      ...(z.condition ? [`⏳ شرط تحلیلگر: ${z.condition}`] : []),
      ...(z.explain ? [`💡 ${z.explain}`] : []),
      ...(ctx.newsRisk ? [`⚠️ خبر مهم نزدیک است: ${ctx.newsRisk}`] : []),
      ...(ctx.invalidation ? [`❌ ابطال: ${breakText(ctx.invalidation)}`] : []),
      "هنوز وارد نشو؛ وقتی تریگر بیاید پیام «✅ وارد شو» می‌گیری.",
    ];
  }
  return { type: "analyst_zone", title, body: [...who(ctx), ...lines, "", FOOTER].join("\n"), data: data(ctx.planId, z, ctx.price) };
}

/** Trigger fired: the owner's "enter now" message. */
export function signalMessage(z: MessageZone, s: SignalInfo, ctx: Pick<MessageContext, "planId" | "source" | "agrees" | "invalidation">): NewNotification & { type: "analyst_zone" } {
  return {
    type: "analyst_zone",
    title: `✅ تریگر ${sideText(z)} ${z.symbol} فعال شد — وارد شو`,
    body: [...who(ctx), ...signalLines(z, s, ctx.invalidation), "", FOOTER].join("\n"),
    data: data(ctx.planId, z, s.entry),
  };
}

/** The public signal post: what to do, where it exits, why the risk is what it is. */
export function signalPost(z: MessageZone, s: SignalInfo, invalidation: MessageZone | null, username: string | null): string {
  return [`${dot(z)} سیگنال ${sideText(z)} | ${z.symbol}`, SEP, ...signalLines(z, s, invalidation), "", SIGNAL_FOOTER, ...handle(username)].join("\n");
}

/** One step of a live signal, as a short line block: posted as a reply under the signal and sent to the owner. */
export function stepText(z: MessageZone, s: Pick<SignalInfo, "entry" | "stopPct" | "targets">, step: SignalStep): { title: string; lines: string[] } {
  const dir = isBuy(z) ? 1 : -1;
  switch (step.kind) {
    case "TP": {
      const t = s.targets[step.index];
      return {
        title: `🎯 TP${step.index + 1} خورد | ${z.symbol} (${signed(t.pct, dir)})`,
        lines: step.index === 0 ? [`حد ضرر را به نقطه‌ی ورود (${fmtPrice(s.entry)}) ببرید و بخشی از سود را سیو کنید.`] : [`قیمت: ${fmtPrice(t.price)}`],
      };
    }
    case "ALL_TP":
      return { title: `🏁 همه‌ی تارگت‌ها خورد | ${z.symbol}`, lines: ["سیگنال بسته شد."] };
    case "STOP":
      return { title: `🛑 SL خورد | ${z.symbol} (${signed(s.stopPct, -1)})`, lines: ["سیگنال بسته شد."] };
    case "BREAKEVEN":
      return { title: `⚪ ریسک‌فری بسته شد | ${z.symbol}`, lines: [`بعد از TP1 قیمت به نقطه‌ی ورود (${fmtPrice(s.entry)}) برگشت.`] };
    case "BROKEN":
      return { title: `⛔ سناریو باطل شد | ${z.symbol}`, lines: [`❌ ${breakText(step.level)}`, "خروج یا مدیریت پوزیشن را در نظر بگیرید."] };
    case "TIMEOUT":
      return { title: `⌛ پیگیری خودکار متوقف شد | ${z.symbol}`, lines: [`${step.days} روز گذشت؛ ادامه‌ی مدیریت با خودتان.`] };
  }
}

export const stepPost = (z: MessageZone, s: Pick<SignalInfo, "entry" | "stopPct" | "targets">, step: SignalStep) => {
  const t = stepText(z, s, step);
  return [t.title, ...t.lines].join("\n");
};

export function stepMessage(z: MessageZone, s: Pick<SignalInfo, "entry" | "stopPct" | "targets">, step: SignalStep, ctx: { planId: string; source: string }): NewNotification & { type: "analyst_zone" } {
  const t = stepText(z, s, step);
  return { type: "analyst_zone", title: t.title, body: [`📌 منبع: ${ctx.source}`, ...t.lines].join("\n"), data: data(ctx.planId, z, s.entry) };
}

/** The trigger did not come: cancelled by a close beyond the zone, or the window ran out. Owner only. */
export function noTriggerMessage(z: MessageZone, why: "CANCELLED" | "EXPIRED", close: number | null, ctx: { planId: string; source: string }): NewNotification & { type: "analyst_zone" } {
  const line = why === "CANCELLED"
    ? `قیمت ${isBuy(z) ? "زیر" : "بالای"} زون ${range(z)} بسته شد${close != null ? ` (${fmtPrice(close)})` : ""}؛ این ستاپ دیگر معتبر نیست.`
    : "۲۴ ساعت بعد از رسیدن به زون، تریگر نیامد؛ این ستاپ کنار گذاشته شد.";
  return { type: "analyst_zone", title: `✖️ تریگر ${sideText(z)} ${z.symbol} نیامد`, body: [`📌 منبع: ${ctx.source}`, line].join("\n"), data: data(ctx.planId, z, close ?? z.low) };
}
