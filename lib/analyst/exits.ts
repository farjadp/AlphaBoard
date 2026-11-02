import { exitFromPercent } from "@/lib/trading/math";

/**
 * Stops, targets and the risk level attached to a zone alert (P18a). Exits are percents of the entry price, as the
 * owner sets them per plan. The risk level is rule-based and explained: no model guesses a probability.
 */
export function exitsFor(side: "BUY" | "SELL", entry: number, stopPct: number, targetPcts: number[]): { stop: number; targets: number[] } {
  return {
    stop: exitFromPercent(side, "stop", entry, stopPct),
    targets: targetPcts.map((p) => exitFromPercent(side, "target", entry, p)).filter((t) => t > 0),
  };
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export const RISK_TEXT: Record<RiskLevel, string> = { LOW: "کم", MEDIUM: "متوسط", HIGH: "بالا" };

/** A source's record counts once this many of its zones were reached. */
export const MIN_RECORD = 30;
const FAST_MOVE_ATR = 2;

export interface RiskInput {
  side: "BUY" | "SELL";
  /** Trend of the 4H candles ("Bullish" | "Bearish" | "Neutral"), null when unknown. */
  trend4h: string | null;
  newsRisk: string | null;
  atr1h: number | null;
  /** High − low of the last hour of price, same units as atr1h. */
  lastHourRange: number | null;
  /** Reached zones of this source and how many held. */
  record: { touched: number; respected: number } | null;
}

/** One point per risk (against the 4H trend, news nearby, a fast move in, a weak source); a strong source takes one off. */
export function riskLevel(r: RiskInput): { level: RiskLevel; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const against = r.side === "BUY" ? "Bearish" : "Bullish";
  const along = r.side === "BUY" ? "Bullish" : "Bearish";
  if (r.trend4h === against) { score++; reasons.push("خلاف روند ۴ساعته"); }
  else if (r.trend4h === along) reasons.push("هم‌جهت با روند ۴ساعته");
  if (r.newsRisk) { score++; reasons.push(`خبر مهم نزدیک است: ${r.newsRisk}`); }
  if (r.atr1h && r.lastHourRange != null && r.lastHourRange > FAST_MOVE_ATR * r.atr1h) {
    score++;
    reasons.push("ورود با حرکت تند (بیش از ۲ برابر ATR یک‌ساعته)");
  }
  if (!r.record || r.record.touched < MIN_RECORD) reasons.push("منبع هنوز آمار کافی ندارد");
  else {
    const pct = Math.round((r.record.respected / r.record.touched) * 100);
    if (pct < 45) { score++; reasons.push(`کارنامه‌ی ضعیف منبع: ${pct}٪ از ${r.record.touched} زون`); }
    else if (pct >= 60) { score--; reasons.push(`کارنامه‌ی خوب منبع: ${pct}٪ از ${r.record.touched} زون`); }
    else reasons.push(`کارنامه‌ی متوسط منبع: ${pct}٪ از ${r.record.touched} زون`);
  }
  return { level: score <= 0 ? "LOW" : score === 1 ? "MEDIUM" : "HIGH", reasons };
}
