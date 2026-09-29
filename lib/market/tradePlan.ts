/** Turns an AI strategy (fresh or archived) into what the trade ticket shows. Pure. */

export interface PlanInput {
  signal: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
}

export interface TradePlan {
  direction: "long" | "short" | "none";
  /** Distance entry → stop, % of entry. */
  riskPct: number | null;
  /** Distance entry → take profit, % of entry. */
  rewardPct: number | null;
  /** Reward ÷ risk; null when levels are missing or contradict the direction. */
  rr: number | null;
  /** Stop and target sit on the correct sides of the entry for the direction. */
  consistent: boolean;
  because: string;
}

const valid = (n: number) => Number.isFinite(n) && n > 0;

export function buildTradePlan(input: PlanInput): TradePlan {
  const direction = input.signal === "BUY" ? "long" : input.signal === "SELL" ? "short" : "none";
  const { entry, stopLoss: sl, takeProfit: tp } = input;
  const because = firstSentence(input.reasoning ?? "");

  if (!valid(entry) || !valid(sl) || !valid(tp)) {
    return { direction, riskPct: null, rewardPct: null, rr: null, consistent: false, because };
  }
  const riskPct = (Math.abs(entry - sl) / entry) * 100;
  const rewardPct = (Math.abs(tp - entry) / entry) * 100;
  const consistent = direction === "long" ? sl < entry && entry < tp
    : direction === "short" ? tp < entry && entry < sl
      : false;
  const rr = consistent && riskPct > 0 ? rewardPct / riskPct : null;
  return { direction, riskPct, rewardPct, rr, consistent, because };
}

/** First sentence of the model's reasoning, trimmed to `max` characters on a word boundary. */
export function firstSentence(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const m = clean.match(/^.*?[.!?](?=\s|$)/);
  const sentence = m ? m[0] : clean;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).trimEnd()}…`;
}

export function alertCondition(currentPrice: number, target: number): "above" | "below" {
  return target > currentPrice ? "above" : "below";
}
