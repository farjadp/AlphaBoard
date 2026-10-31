/** Strategy Lab — a DCA-ladder study on a coin basket, with a plain verdict (pure). */
import { signedPct } from "@/lib/format";
import { z } from "zod";
import { runDca, type Cube, type DcaRun } from "./dca";

const pctField = (max: number) => z.number().finite().positive().max(max);

export const DcaStudySchema = z.object({
  kind: z.literal("dca"),
  basketId: z.string().min(1).max(40),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2021-01-01"),
  slots: z.number().int().min(1).max(60).default(15),
  deepSlots: z.number().int().min(0).max(60).default(10),
  dropPct: pctField(50).default(3),
  d1Pct: pctField(90).default(9),
  d2Pct: pctField(95).default(19.5),
  sizes: z.tuple([pctField(100), pctField(100), pctField(100)]).default([1, 1.8, 4.7]),
  tp0Pct: pctField(50).default(1.5),
  tp1Pct: pctField(50).default(1),
  feePct: z.number().finite().min(0).max(1).default(0.05),
  btcLockPct: pctField(50).nullable().default(5),
  stopLossPct: pctField(95).nullable().default(null),
}).strict();

export type DcaStudySpec = z.output<typeof DcaStudySchema>;
export type DcaStudyResult = DcaRun & { start: string; end: string; symbols: number; slots: number; verdict: string[] };

const pct = (x: number, d = 1) => signedPct(x, d);

export function runDcaStudy(cube: Cube, spec: DcaStudySpec): DcaStudyResult {
  const startMs = Date.parse(`${spec.start}T00:00:00Z`);
  const r = runDca(cube, {
    slots: spec.slots, deepSlots: Math.min(spec.deepSlots, spec.slots), drop: spec.dropPct / 100, d1: spec.d1Pct / 100, d2: spec.d2Pct / 100,
    sizes: spec.sizes, tp0: spec.tp0Pct / 100, tp1: spec.tp1Pct / 100, fee: spec.feePct / 100,
    btcLock: spec.btcLockPct == null ? null : spec.btcLockPct / 100, btcIndex: cube.syms.indexOf("BTCUSDT"),
    stopLoss: spec.stopLossPct == null ? null : spec.stopLossPct / 100,
  }, startMs);
  const end = new Date(cube.t[cube.t.length - 1]).toISOString().slice(0, 10);
  const years = Object.entries(r.perYear);
  const best = years.reduce((a, b) => (b[1] > a[1] ? b : a), years[0] ?? ["—", 0]);
  const worst = years.reduce((a, b) => (b[1] < a[1] ? b : a), years[0] ?? ["—", 0]);
  const verdict: string[] = [];
  verdict.push(`$1,000 became $${r.finalBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })} from ${spec.start} to ${end} (${pct(r.monthlyPct, 2)} a month on average), across ${cube.syms.length} coins.`);
  verdict.push(`The deepest fall with open positions marked at market was ${r.maxDdMtmPct.toFixed(1)}%. Counting only closed trades it would have looked like ${r.maxDdRealizedPct.toFixed(1)}%.`);
  if (r.maxDdMtmPct > 3 * Math.max(r.maxDdRealizedPct, 1))
    verdict.push("Most of the losses sat in positions that were never closed — a profit calendar built from closed trades stays green while the account falls.");
  if (years.length > 1) verdict.push(`Best year ${best[0]} (${pct(best[1])}), worst year ${worst[0]} (${pct(worst[1])}).`);
  const [d0, d1, d2] = r.depthShare.map((x) => Math.round(x * 1000) / 10);
  verdict.push(`${r.episodes.toLocaleString("en-US")} ladders closed: ${d0}% at the first buy, ${d1}% after one add, ${d2}% after two. Slots were ${Math.round((r.avgSlots / spec.slots) * 100)}% full on average.`);
  if (spec.stopLossPct != null) verdict.push(`With a stop ${spec.stopLossPct}% under the average, losers are closed instead of held — compare with the same run without a stop.`);
  verdict.push("This is a test on past data — it is not a forecast.");
  return { ...r, start: spec.start, end, symbols: cube.syms.length, slots: spec.slots, verdict };
}
