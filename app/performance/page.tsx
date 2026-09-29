import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import NavBar from "@/components/NavBar";
import LineChart from "@/components/charts/LineChart";
import FilterBar from "@/components/performance/FilterBar";
import CalibrationChart from "@/components/performance/CalibrationChart";
import OutcomeBadge from "@/components/performance/OutcomeBadge";
import { pctOrDash, r, ratio, rTone } from "@/components/performance/format";
import { getSessionUser } from "@/lib/auth/dal";
import { userPerformance } from "@/lib/eval/performance";
import { HORIZON_BARS } from "@/lib/eval/evaluator";
import type { Summary } from "@/lib/eval/metrics";

export const dynamic = "force-dynamic";

const Filters = z.object({
  symbol: z.string().max(30).optional().catch(undefined),
  timeframe: z.string().max(10).optional().catch(undefined),
  model: z.string().max(80).optional().catch(undefined),
  days: z.coerce.number().int().min(1).max(3650).optional().catch(undefined),
});

function Stat({ label, value, sub, tone = "text-ink" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3";
const td = "px-3 py-2 tabular-nums";

function Breakdown({ title, rows }: { title: string; rows: Array<Summary & { key: string }> }) {
  return (
    <section className="panel overflow-hidden">
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{title}</h2>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`${title} table`}>
        <table className="w-full min-w-[480px] text-sm text-ink-2">
          <thead><tr className="border-b border-line">
            <th className={th}><span className="sr-only">{title.replace(/^By /, "")}</span></th><th className={`${th} text-right`}>Trades</th><th className={`${th} text-right`}>Win rate</th>
            <th className={`${th} text-right`}>Expectancy</th><th className={`${th} text-right`}>Profit factor</th><th className={`${th} text-right`}>Total</th>
          </tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.key} className="border-b border-line last:border-0">
                <td className={`${td} text-ink`}>{g.key}{g.open > 0 && <span className="ml-2 text-[11px] text-ink-3">{g.open} open</span>}</td>
                <td className={`${td} text-right`}>{g.trades}</td>
                <td className={`${td} text-right`}>{pctOrDash(g.winRate)}</td>
                <td className={`${td} text-right ${rTone(g.expectancyR)}`}>{r(g.expectancyR)}</td>
                <td className={`${td} text-right`}>{ratio(g.profitFactor)}</td>
                <td className={`${td} text-right ${rTone(g.totalR)}`}>{g.trades ? r(g.totalR) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function PerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const raw = await searchParams;
  const filters = Filters.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined])));
  const p = await userPerformance(user.id, filters);
  const s = p.summary;
  const pending = s.open + s.noFill + s.invalid;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-page">
      <NavBar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold text-ink">Signal performance</h1>
              <p className="mt-1 max-w-3xl text-sm text-ink-3">
                Every BUY/SELL strategy from the Archive is replayed on the candles that came after it: did price reach the target or the stop first?
                Results are in R (1R = the distance from entry to stop), with no fees.
              </p>
            </div>
            <Suspense><FilterBar options={p.options} /></Suspense>
          </header>

          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" aria-label="Summary">
            <Stat label="Evaluated" value={String(s.trades)} sub={`${s.open} open · ${p.holds} HOLD skipped`} />
            <Stat label="Win rate" value={pctOrDash(s.winRate)} sub={s.trades ? `${s.wins} of ${s.trades}` : "No closed signals yet"} />
            <Stat label="Expectancy" value={r(s.expectancyR)} tone={rTone(s.expectancyR)} sub="Average R per signal" />
            <Stat label="Profit factor" value={ratio(s.profitFactor)} sub="Gross win R ÷ gross loss R" />
            <Stat label="Total" value={s.trades ? r(s.totalR) : "—"} tone={rTone(s.totalR)} sub={`Avg win ${r(s.avgWinR)} · loss ${r(s.avgLossR)}`} />
            <Stat label="Max drawdown" value={s.maxDrawdownR == null ? "—" : r(-s.maxDrawdownR)} tone={s.maxDrawdownR ? "text-down" : undefined} sub="Peak-to-trough, cumulative R" />
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className="panel p-5">
              <h2 className="mb-3 text-sm font-semibold text-ink">Cumulative R</h2>
              <LineChart
                points={p.curve.map((c) => ({ at: c.at, value: c.cumR }))} baseline={0} baselineLabel="0R" unit="r" title="Cumulative R"
                empty="The curve appears once at least two signals have resolved. Signals are checked every minute."
              />
            </section>
            <section className="panel p-5">
              <h2 className="text-sm font-semibold text-ink">Calibration</h2>
              <p className="mb-3 mt-1 text-xs text-ink-3">Does a higher stated confidence actually win more often?</p>
              <CalibrationChart rows={p.calibration} />
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Breakdown title="By model" rows={p.byModel} />
            <Breakdown title="By asset" rows={p.bySymbol} />
            <Breakdown title="By timeframe" rows={p.byTimeframe} />
            <Breakdown title="By stated confidence" rows={p.byConfidence} />
          </div>

          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Recent signals</h2>
              <Link href="/archive" className="inline-flex min-h-6 items-center text-xs text-accent hover:underline">Open the Archive →</Link>
            </div>
            {p.recent.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-3">No BUY/SELL signals match these filters. Generate a strategy from the dashboard; it is evaluated automatically.</p>
            ) : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recent signals table">
                <table className="w-full min-w-[720px] text-sm text-ink-2">
                  <thead><tr className="border-b border-line">
                    <th className={th}>Signal</th><th className={th}>Created</th><th className={th}>Entry / Stop / Target</th><th className={th}>Model</th><th className={th}>Outcome</th>
                  </tr></thead>
                  <tbody>
                    {p.recent.map((x) => (
                      <tr key={x.id} className="border-b border-line last:border-0">
                        <td className={td}><span className="font-semibold text-ink">{x.symbol}</span> <span className={x.signal === "BUY" ? "text-up" : "text-down"}>{x.signal}</span> <span className="text-ink-3">{x.timeframe} · {x.confidence}%</span></td>
                        <td className={td}>{new Date(x.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</td>
                        <td className={td}>{x.entry} / <span className="text-down">{x.stopLoss}</span> / <span className="text-up">{x.takeProfit}</span></td>
                        <td className={`${td} text-ink-3`}>{x.model}</td>
                        <td className={td}><OutcomeBadge status={x.status} rMultiple={x.rMultiple} note={x.note} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <details className="text-xs text-ink-3">
            <summary className="cursor-pointer text-ink-2">How signals are scored{pending ? ` · ${s.noFill} entry not reached, ${s.invalid} not evaluable` : ""}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
              <li>Candles of the signal&apos;s own timeframe, starting with the first candle that opened after the signal.</li>
              <li>If the entry was within 0.1% of the price at the time, the trade starts immediately; otherwise it starts when price reaches the entry. Signals whose entry is never reached are “entry not reached” and do not count toward win rate.</li>
              <li>Stop and target in the same candle count as a stop. On the candle that fills the entry, only the stop counts. A gap through the stop exits at the open.</li>
              <li>Horizon: {Object.entries(HORIZON_BARS).filter(([k]) => k !== "5M").map(([k, v]) => `${k} ${v} bars`).join(" · ")}. Still open after that → expired at the last close.</li>
            </ul>
          </details>
        </div>
      </main>
    </div>
  );
}
