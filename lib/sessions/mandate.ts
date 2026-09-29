/**
 * The frozen rules of a trading session (spec P8 §3). Every limit here is enforced in code by the
 * risk engine / session monitor — prompts only describe them to the agents.
 */
import { z } from "zod";
import { findAsset } from "@/lib/assetCatalog";

export const ModelRefSchema = z.object({ provider: z.string().min(1).max(40), model: z.string().min(1).max(120) }).strict();
export type ModelRef = z.output<typeof ModelRefSchema>;

const modelRef = ModelRefSchema.nullable().default(null);

export const MandateSchema = z
  .object({
    venue: z.enum(["paper", "exchange"]).default("paper"),
    /** ExchangeConnection id when venue = exchange. */
    connectionId: z.string().min(1).max(40).nullable().default(null),
    marketType: z.enum(["spot", "swap"]).default("spot"),
    symbols: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
    capital: z.number().finite().min(10).max(10_000_000),
    maxLeverage: z.number().finite().min(1).max(50).default(1),
    marginMode: z.literal("isolated").default("isolated"),
    riskPerTradePct: z.number().finite().min(0.1).max(10).default(1),
    maxPositionPct: z.number().finite().min(5).max(100).default(50),
    maxOpenPositions: z.number().int().min(1).max(10).default(2),
    maxTrades: z.number().int().min(1).max(100).default(6),
    /** Quote-currency amount; defaults to 10% of capital. */
    lossLimit: z.number().finite().positive().optional(),
    durationMin: z.number().int().min(15).max(1440).default(480),
    decisionIntervalMin: z.number().int().min(5).max(240).default(30),
    cooldownMin: z.number().int().min(0).max(1440).default(30),
    onEnd: z.enum(["CLOSE_ALL", "KEEP_WITH_STOPS"]).default("CLOSE_ALL"),
    extensionTimeoutMin: z.number().int().min(1).max(60).default(5),
    orderStyle: z.enum(["market", "limit_post_only"]).default("market"),
    models: z
      .object({ analyst: modelRef, strategist: modelRef, journal: modelRef })
      .strict()
      .default({ analyst: null, strategist: null, journal: null }),
    debate: z.boolean().default(false),
    maxLlmCostUsd: z.number().finite().min(0.05).max(100).default(1),
  })
  .strict();

export type MandateInput = z.input<typeof MandateSchema>;
export type Mandate = Omit<z.output<typeof MandateSchema>, "lossLimit"> & { lossLimit: number };

export class MandateError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid mandate: ${issues.join("; ")}`);
    this.name = "MandateError";
  }
}

/** Validates, applies defaults and cross-field rules. Throws MandateError with readable issues. */
export function parseMandate(input: unknown): Mandate {
  const r = MandateSchema.safeParse(input);
  if (!r.success) throw new MandateError(r.error.issues.map((i) => `${i.path.join(".") || "mandate"}: ${i.message}`));
  const m = r.data;
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const s of m.symbols) {
    if (!findAsset(s)) issues.push(`symbols: ${s} is not a supported symbol`);
    if (seen.has(s)) issues.push(`symbols: ${s} is listed more than once`);
    seen.add(s);
  }
  if (m.marketType === "spot" && m.maxLeverage !== 1) issues.push("maxLeverage: spot sessions trade without leverage (use 1 or switch to swap)");
  const lossLimit = m.lossLimit ?? Math.round(m.capital * 0.1 * 100) / 100;
  if (lossLimit > m.capital) issues.push("lossLimit: the loss limit cannot exceed the session capital");
  if (m.orderStyle !== "market") issues.push("orderStyle: sessions place market orders only for now");
  if (m.venue === "exchange" && !m.connectionId) issues.push("connectionId: pick an exchange connection");
  if (m.venue === "paper" && m.connectionId) issues.push("connectionId: only exchange sessions use a connection");
  if (issues.length) throw new MandateError(issues);
  return { ...m, lossLimit };
}
