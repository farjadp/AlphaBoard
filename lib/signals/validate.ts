import { z } from "zod";

/** A Signal Desk signal as written in the form (P12). Risk is capped at 1 %; a stop is mandatory. */
export const signalInput = z.object({
  symbol: z.string().trim().min(1).max(32),
  side: z.enum(["BUY", "SELL"]),
  /** Reference price for the post and the slippage guard; null = market now. */
  entry: z.number().positive().nullable().default(null),
  stop: z.number().positive(),
  tps: z.array(z.number().positive()).max(4).default([]),
  riskPct: z.number().positive().max(1).default(0.5),
  maxDeviation: z.number().positive().nullable().default(null),
  note: z.string().trim().max(280).nullable().default(null),
  /** Where the idea came from; stored, never posted. */
  source: z.string().trim().max(80).nullable().default(null),
  execute: z.boolean(),
  post: z.boolean(),
});
export type SignalInput = z.infer<typeof signalInput>;

/** Rule violations as user-facing strings; [] when the signal is valid. Prices are checked against `entry` when given. */
export function checkSignal(s: SignalInput, ctx: { symbols: string[] }): string[] {
  const errs: string[] = [];
  const dir = s.side === "BUY" ? 1 : -1;
  if (!s.execute && !s.post) errs.push("choose post, execute or both");
  if (!s.execute && s.entry == null) errs.push("entry is required when the signal is not executed");
  if (s.execute && !ctx.symbols.includes(s.symbol)) errs.push(`${s.symbol} is not in the terminal's symbol list`);
  const ref = s.entry;
  if (ref != null && (s.stop - ref) * dir >= 0) errs.push(`stop must be ${dir > 0 ? "below" : "above"} entry for a ${s.side}`);
  const chain = ref != null ? [ref, ...s.tps] : s.tps;
  for (let i = 1; i < chain.length; i++) {
    if ((chain[i] - chain[i - 1]) * dir <= 0) {
      errs.push("TPs must move away from entry in order");
      break;
    }
  }
  if (ref == null && s.tps.length && (s.tps[0] - s.stop) * dir <= 0) errs.push("TPs must be on the profit side of the stop");
  return errs;
}
