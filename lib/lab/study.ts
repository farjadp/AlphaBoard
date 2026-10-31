/**
 * Strategy Lab — a full study of the GoldHedgeManager-style set on one series (pure): every allowed
 * candle as an entry, per-set statistics, the money-management account on the full entry list, and the
 * same account on K random halves so luck shows up as a range. The verdict leads with plain sentences.
 */
import { signedPct } from "@/lib/format";
import { z } from "zod";
import { runAccount, type AccountRun, type MoneyRules } from "./account";
import { bucketStarts, holeAfter, medianRange, noHoles, trendH4, type Bars } from "./bars";
import { ladderParams, runLadderSet, type SetKind } from "./ladder";
import { halfSubset, spread, type Spread } from "./robust";

const multiple = z.number().finite().positive().max(20);

export const LadderStudySchema = z.object({
  kind: z.literal("ladder"),
  datasetId: z.string().min(1).max(40),
  /** The second position (P2) of the EA; off = a single position with a stop. */
  secondPosition: z.boolean().default(false),
  /** Distances in 15-minute candles (the median candle of the series is 1). */
  distances: z.object({
    p2: multiple.default(1), s2: multiple.default(0.625), stop: multiple.default(1.625),
    target: multiple.default(1.25), p2Target: multiple.default(0.625), buffer: z.number().finite().min(0).max(1).default(0.0375),
  }).strict().prefault({}),
  /** Commission per position, price units, added to the series' median spread. */
  commission: z.number().finite().min(0).max(1_000).default(0),
  entryEveryMin: z.literal(15).default(15),
  /** UTC hours [from, to) in which a set may start. */
  hoursUtc: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)]).default([1, 21]),
  direction: z.enum(["trend", "both", "long", "short"]).default("trend"),
  money: z.object({
    riskPct: z.number().finite().min(0.05).max(5).default(0.5),
    slots: z.number().int().min(1).max(10).default(1),
    dailyLossPct: z.number().finite().min(0.5).max(20).nullable().default(2),
    maxConsecLosses: z.number().int().min(0).max(10).default(2),
    cooldownMin: z.number().int().min(0).max(1440).default(30),
    martingale: z.boolean().default(false),
  }).strict().prefault({}),
  /** Random halves of the entry list (0 = only the full run). */
  robustness: z.number().int().min(0).max(50).default(30),
  /** keep: gaps are market closures that positions live through (broker export); drop: missing data. */
  holes: z.enum(["keep", "drop"]).default("keep"),
}).strict();

export type LadderStudySpec = z.output<typeof LadderStudySchema>;

export interface LadderStudyResult {
  bars: number;
  from: number;
  to: number;
  unit: number;
  cost: number;
  sets: { count: number; avgPctOfRisk: number; returnToEntry: number | null; coinFlip: number | null; kinds: Partial<Record<SetKind, number>> };
  account: {
    full: Omit<AccountRun, "curve"> & { curve: Array<[number, number]> };
    robust: { runs: number; returnPct: Spread; maxDdMtmMedian: number; tradesMedian: number } | null;
  };
  verdict: string[];
}

const pct = (x: number, d = 1) => signedPct(x, d);

function downsample(curve: Array<[number, number]>, max = 300): Array<[number, number]> {
  if (curve.length <= max) return curve;
  const step = curve.length / max;
  const out: Array<[number, number]> = [];
  for (let k = 0; k < max; k++) out.push(curve[Math.floor(k * step)]);
  out.push(curve[curve.length - 1]);
  return out;
}

export function runLadderStudy(b: Bars, spreadCol: Float64Array | null, spec: LadderStudySpec): LadderStudyResult {
  const unit = medianRange(b, 15);
  if (!(b.t.length >= 200) || !(unit > 0)) throw new Error("the series is too short to measure a 15-minute candle");
  let medSpread = 0;
  if (spreadCol && spreadCol.length) {
    const s = Float64Array.from(spreadCol).sort();
    medSpread = s[s.length >> 1];
  }
  const cost = medSpread + spec.commission;
  const d = spec.distances;
  const p = ladderParams(unit, cost, spec.secondPosition
    ? { p2: d.p2, s2: d.s2, sl1: d.p2 + d.s2, ta: d.target, tb: d.p2Target, buf: d.buffer }
    : { p2: null, sl1: d.stop, ta: d.target, tb: d.p2Target, buf: d.buffer });
  const holes = spec.holes === "keep" ? noHoles(b) : holeAfter(b);
  const trend = trendH4(b);
  const [h0, h1] = spec.hoursUtc;
  const grid = Array.from(bucketStarts(b, spec.entryEveryMin)).filter((i) => {
    const t = new Date(b.t[i]);
    return t.getUTCMinutes() % spec.entryEveryMin === 0 && t.getUTCHours() >= h0 && t.getUTCHours() < h1 && t.getUTCDay() >= 1 && t.getUTCDay() <= 5;
  });

  // Per-set statistics: every grid candle, in the study's direction(s).
  const dirsAt = (i: number): Array<1 | -1> =>
    spec.direction === "both" ? [1, -1] : spec.direction === "long" ? [1] : spec.direction === "short" ? [-1] : trend[i] ? [trend[i] as 1 | -1] : [];
  let count = 0, sumR = 0, back = 0, decided = 0;
  const kinds: Partial<Record<SetKind, number>> = {};
  for (const i of grid) for (const dir of dirsAt(i)) {
    const r = runLadderSet(b, holes, i, dir, p);
    if (!r) continue;
    count++; sumR += r.pnl / r.worst; kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
    if (r.returned != null && r.kind !== "OPEN") { decided++; if (r.returned) back++; }
  }

  // The account: one direction per entry ("both" alternates, as the research did).
  let flip: 1 | -1 = 1;
  const dirOf = (i: number): -1 | 0 | 1 => {
    if (spec.direction === "trend") return trend[i] as -1 | 0 | 1;
    if (spec.direction === "long") return 1;
    if (spec.direction === "short") return -1;
    flip = flip === 1 ? -1 : 1;
    return flip;
  };
  const rules: MoneyRules = spec.money;
  const sim = (i: number, dir: 1 | -1) => runLadderSet(b, holes, i, dir, p);
  const full = runAccount(b, grid, dirOf, sim, rules);
  let robust: LadderStudyResult["account"]["robust"] = null;
  if (spec.robustness > 0) {
    const runs: AccountRun[] = [];
    for (let s = 0; s < spec.robustness; s++) { flip = 1; runs.push(runAccount(b, halfSubset(grid, s), dirOf, sim, rules)); }
    robust = {
      runs: runs.length,
      returnPct: spread(runs.map((r) => r.returnPct)),
      maxDdMtmMedian: spread(runs.map((r) => r.maxDdMtmPct)).median,
      tradesMedian: spread(runs.map((r) => r.trades)).median,
    };
  }

  const coinFlip = spec.secondPosition ? d.s2 / (d.p2 + d.s2) : null;
  const returnToEntry = decided ? back / decided : null;
  const avgPctOfRisk = count ? (sumR / count) * 100 : 0;
  const verdict: string[] = [];
  verdict.push(`Across ${count.toLocaleString("en-US")} sets (one at every allowed 15-minute candle), the average set ${avgPctOfRisk >= 0 ? "made" : "lost"} ${Math.abs(avgPctOfRisk).toFixed(1)}% of the amount it put at risk, after costs of ${cost.toPrecision(3)} per position.`);
  if (returnToEntry != null && coinFlip != null)
    verdict.push(`After the second position filled, price came back to the first entry ${(returnToEntry * 100).toFixed(1)}% of the time. A coin flip would give ${(coinFlip * 100).toFixed(1)}%${Math.abs(returnToEntry - coinFlip) < 0.03 ? " — no edge in the return itself" : ""}.`);
  verdict.push(`With these money rules, $1,000 became $${full.finalBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${pct(full.returnPct)}) over ${full.trades.toLocaleString("en-US")} trades. The deepest fall with open positions counted was ${full.maxDdMtmPct.toFixed(1)}%.`);
  if (robust) {
    const pos = Math.round(robust.returnPct.positiveShare * robust.runs);
    verdict.push(`Across ${robust.runs} random halves of the entries: median ${pct(robust.returnPct.median)}, worst ${pct(robust.returnPct.min)}, best ${pct(robust.returnPct.max)}; ${pos} of ${robust.runs} ended positive.`);
    if (robust.returnPct.positiveShare < 0.8) verdict.push("Not robust: the outcome depends on which trades happen to be taken.");
  }
  if (spec.money.martingale) verdict.push("Martingale doubles the risk after every loss: a long losing streak can take most of the account, whatever the average says.");
  verdict.push("This is a test on past data with entries at every allowed candle — it measures the rules, not your entries, and it is not a forecast.");

  const { curve, ...rest } = full;
  return {
    bars: b.t.length, from: b.t[0], to: b.t[b.t.length - 1], unit, cost,
    sets: { count, avgPctOfRisk, returnToEntry, coinFlip, kinds },
    account: { full: { ...rest, curve: downsample(curve) }, robust },
    verdict,
  };
}
