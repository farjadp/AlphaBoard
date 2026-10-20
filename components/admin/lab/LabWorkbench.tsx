"use client";

import { useEffect, useState } from "react";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";
import type { DatasetDto } from "@/lib/lab/data/store";
import type { LabJobDto } from "@/lib/lab/jobs";
import type { LadderStudyResult } from "@/lib/lab/study";

const datasetsRes = createResource<DatasetDto[]>("/api/admin/lab/datasets", { fallback: [], select: (j) => (j as { datasets: DatasetDto[] }).datasets });
const jobsRes = createResource<LabJobDto[]>("/api/admin/lab/jobs", { fallback: [], select: (j) => (j as { jobs: LabJobDto[] }).jobs });

const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";
const label = "mb-1 block text-xs font-semibold text-ink-2";
const hint = "mt-1 text-xs text-ink-3";
const btn = "rounded-lg bg-ink px-4 py-2 text-sm font-bold text-paper hover:bg-ink-hover disabled:opacity-50";
const day = (iso: string) => iso.slice(0, 10);
const pct = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%`;

export interface LabProps {
  binanceSymbols: string[];
  oandaSymbols: string[];
  oandaConnections: Array<{ id: string; label: string }>;
}

export default function LabWorkbench(props: LabProps) {
  const jobs = useResource(jobsRes);
  const active = jobs.data.some((j) => j.status === "QUEUED" || j.status === "RUNNING");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { void jobsRes.load(true); void datasetsRes.load(true); }, 3_000);
    return () => clearInterval(t);
  }, [active]);

  return (
    <div className="space-y-8">
      <DataPanel {...props} />
      <StudyForm />
      <Results jobs={jobs.data} error={jobs.error} />
    </div>
  );
}

/* ───────────────────────────── data ───────────────────────────── */

function DataPanel({ binanceSymbols, oandaSymbols, oandaConnections }: LabProps) {
  const { data, error } = useResource(datasetsRes);
  const [source, setSource] = useState<"binance" | "oanda">(oandaConnections.length ? "oanda" : "binance");
  const symbols = source === "binance" ? binanceSymbols : oandaSymbols;
  const [symbol, setSymbol] = useState(symbols[0] ?? "");
  const [days, setDays] = useState("365");
  const [conn, setConn] = useState(oandaConnections[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"fetch" | "upload" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function download(e: React.FormEvent) {
    e.preventDefault();
    setBusy("fetch"); setMsg(null);
    try {
      await jobsRes.mutate({ request: jsonRequest("/api/admin/lab/jobs", "POST", { kind: "fetch", source, symbol, timeframe: "1m", days: Number(days), ...(source === "oanda" ? { connectionId: conn } : {}) }) });
      await jobsRes.load(true);
      setMsg("Download queued — it appears in the list when it is done.");
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setBusy(null); }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy("upload"); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("size", String(file.size));
      if (name.trim()) fd.set("symbol", name.trim());
      await datasetsRes.mutate({ request: () => fetch("/api/admin/lab/datasets", { method: "POST", body: fd, credentials: "same-origin" }) });
      await datasetsRes.load(true);
      setFile(null); setName("");
      setMsg("Uploaded.");
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setBusy(null); }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this dataset?")) return;
    await datasetsRes.mutate({ optimistic: (d) => d.filter((x) => x.id !== id), request: jsonRequest(`/api/admin/lab/datasets/${id}`, "DELETE") }).catch(() => undefined);
  }

  return (
    <section aria-labelledby="lab-data" className="panel p-5">
      <h2 id="lab-data" className="font-display text-lg font-bold text-ink">Price data</h2>
      <p className="mt-1 text-sm text-ink-2">One-minute bars, so stops and targets inside a candle are resolved correctly. A broker&apos;s own export (ExportM1) tests on the exact prices you trade.</p>
      {error && <p role="alert" className="mt-3 text-sm text-down">{error}</p>}
      {data.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3"><tr><th className="p-2 font-medium">Symbol</th><th className="p-2 font-medium">Source</th><th className="p-2 font-medium">Range</th><th className="p-2 text-right font-medium">Bars</th><th className="p-2 font-medium">Spread</th><th className="p-2" /></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="p-2 font-semibold text-ink">{d.symbol}</td>
                  <td className="p-2 text-ink-2">{d.source === "mt5csv" ? "MT5 export" : d.source === "oanda" ? "OANDA" : "Binance"}</td>
                  <td className="p-2 text-ink-2">{day(d.fromAt)} → {day(d.toAt)}</td>
                  <td className="num p-2 text-right">{d.bars.toLocaleString("en-US")}</td>
                  <td className="p-2 text-ink-2">{d.hasSpread ? "real" : "add as commission"}</td>
                  <td className="p-2 text-right"><button type="button" onClick={() => void remove(d.id)} className="text-xs font-semibold text-ink-3 hover:text-down">Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="mt-4 text-sm text-ink-3">No data yet.</p>}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <form onSubmit={download} className="space-y-3 rounded-lg border border-line p-4">
          <h3 className="text-sm font-bold text-ink">Download</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="lab-source" className={label}>Source</label>
              <select id="lab-source" className={field} value={source} onChange={(e) => { const s = e.target.value as "binance" | "oanda"; setSource(s); setSymbol((s === "binance" ? binanceSymbols : oandaSymbols)[0] ?? ""); }}>
                <option value="oanda" disabled={!oandaConnections.length}>OANDA (forex, metals)</option>
                <option value="binance">Binance (crypto)</option>
              </select>
            </div>
            <div>
              <label htmlFor="lab-symbol" className={label}>Symbol</label>
              <select id="lab-symbol" className={field} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="lab-days" className={label}>Days back</label>
              <input id="lab-days" type="number" min={7} max={730} className={field} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            {source === "oanda" && (
              <div>
                <label htmlFor="lab-conn" className={label}>OANDA connection</label>
                <select id="lab-conn" className={field} value={conn} onChange={(e) => setConn(e.target.value)}>
                  {oandaConnections.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <p className={hint}>Read-only: candles only.</p>
              </div>
            )}
          </div>
          <button type="submit" disabled={busy !== null || !symbol} className={btn}>{busy === "fetch" ? "Queuing…" : "Download"}</button>
        </form>

        <form onSubmit={upload} className="space-y-3 rounded-lg border border-line p-4">
          <h3 className="text-sm font-bold text-ink">Upload an MT5 export</h3>
          <div>
            <label htmlFor="lab-file" className={label}>ExportM1 CSV</label>
            <input id="lab-file" type="file" accept=".csv,text/csv" className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-wash file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className={hint}>From MetaTrader: Scripts → ExportM1. Up to about a year of one-minute bars.</p>
          </div>
          <div>
            <label htmlFor="lab-name" className={label}>Name (optional)</label>
            <input id="lab-name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. XAUUSD ePlanet" />
          </div>
          <button type="submit" disabled={busy !== null || !file} className={btn}>{busy === "upload" ? "Uploading…" : "Upload"}</button>
        </form>
      </div>
      {msg && <p role="status" className="mt-3 text-sm text-ink-2">{msg}</p>}
    </section>
  );
}

/* ───────────────────────────── new study ───────────────────────────── */

function Num({ id, text, value, onChange, help, step = "any" }: { id: string; text: string; value: string; onChange: (v: string) => void; help?: string; step?: string }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      <input id={id} type="number" inputMode="decimal" step={step} className={field} value={value} onChange={(e) => onChange(e.target.value)} />
      {help && <p className={hint}>{help}</p>}
    </div>
  );
}

function StudyForm() {
  const { data: datasets } = useResource(datasetsRes);
  const minute = datasets.filter((d) => d.timeframe === "1m");
  const [datasetId, setDatasetId] = useState("");
  const chosen = datasetId || minute[0]?.id || "";
  const [p2, setP2] = useState(false);
  const [direction, setDirection] = useState("trend");
  const [risk, setRisk] = useState("0.5");
  const [slots, setSlots] = useState("1");
  const [dayLock, setDayLock] = useState("2");
  const [streak, setStreak] = useState("2");
  const [pause, setPause] = useState("30");
  const [martingale, setMartingale] = useState(false);
  const [commission, setCommission] = useState("0.1");
  const [robust, setRobust] = useState("30");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await jobsRes.mutate({
        request: jsonRequest("/api/admin/lab/jobs", "POST", {
          kind: "ladder", datasetId: chosen, secondPosition: p2, direction, commission: Number(commission), robustness: Number(robust),
          money: { riskPct: Number(risk), slots: Number(slots), dailyLossPct: Number(dayLock) > 0 ? Number(dayLock) : null, maxConsecLosses: Number(streak), cooldownMin: Number(pause), martingale },
        }),
      });
      await jobsRes.load(true);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={run} aria-labelledby="lab-study" className="panel space-y-5 p-5">
      <div>
        <h2 id="lab-study" className="font-display text-lg font-bold text-ink">New test</h2>
        <p className="mt-1 text-sm text-ink-2">Opens a trade at every allowed 15-minute candle and applies your rules — so the result measures the rules, not anyone&apos;s eye for entries. Distances are in 15-minute candles of the data (the median candle is 1).</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="lab-ds" className={label}>Data</label>
          <select id="lab-ds" className={field} value={chosen} onChange={(e) => setDatasetId(e.target.value)}>
            {minute.length === 0 && <option value="">Add data first</option>}
            {minute.map((d) => <option key={d.id} value={d.id}>{d.symbol} · {day(d.fromAt)} → {day(d.toAt)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lab-shape" className={label}>Positions</label>
          <select id="lab-shape" className={field} value={p2 ? "p2" : "single"} onChange={(e) => setP2(e.target.value === "p2")}>
            <option value="single">One position with a stop</option>
            <option value="p2">Two positions (a second one, 1 candle against)</option>
          </select>
        </div>
        <div>
          <label htmlFor="lab-dir" className={label}>Direction</label>
          <select id="lab-dir" className={field} value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="trend">With the 4-hour trend</option>
            <option value="both">Both, alternating</option>
            <option value="long">Long only</option>
            <option value="short">Short only</option>
          </select>
        </div>
        <Num id="lab-risk" text="Risk per trade (%)" value={risk} onChange={setRisk} help="Of the balance, at the worst case of the trade." />
        <Num id="lab-slots" text="Trades open at once" value={slots} onChange={setSlots} step="1" help="The risk is split between them." />
        <Num id="lab-daylock" text="Daily loss lock (%)" value={dayLock} onChange={setDayLock} help="0 = off." />
        <Num id="lab-streak" text="Stop after losses in a row" value={streak} onChange={setStreak} step="1" help="For the rest of the day. 0 = off." />
        <Num id="lab-pause" text="Pause after a loss (min)" value={pause} onChange={setPause} step="1" help="0 = off." />
        <Num id="lab-comm" text="Commission per trade (price)" value={commission} onChange={setCommission} help="Added to the data's own spread." />
        <Num id="lab-robust" text="Random re-runs" value={robust} onChange={setRobust} step="1" help="Each uses a random half of the entries, to show how much is luck." />
        <div className="flex items-start gap-2 pt-6">
          <input id="lab-mart" type="checkbox" checked={martingale} onChange={(e) => setMartingale(e.target.checked)} className="mt-1 size-4 accent-ink" />
          <label htmlFor="lab-mart" className="text-sm text-ink-2">Martingale (double after a loss) — the warning case</label>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !chosen} className={btn}>{busy ? "Queuing…" : "Run test"}</button>
        {msg && <p role="alert" className="text-sm text-down">{msg}</p>}
      </div>
    </form>
  );
}

/* ───────────────────────────── results ───────────────────────────── */

type StudyResult = LadderStudyResult & { dataset: DatasetDto };

function Results({ jobs, error }: { jobs: LabJobDto[]; error: string | null }) {
  return (
    <section aria-labelledby="lab-results" className="space-y-4">
      <h2 id="lab-results" className="font-display text-lg font-bold text-ink">Results</h2>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      {jobs.length === 0 && <p className="text-sm text-ink-3">No tests yet.</p>}
      {jobs.map((j) => <JobCard key={j.id} job={j} />)}
    </section>
  );
}

function JobCard({ job }: { job: LabJobDto }) {
  const spec = job.spec as { kind: string; symbol?: string; days?: number; secondPosition?: boolean; direction?: string; money?: { riskPct: number; slots: number } };
  const title = job.kind === "FETCH"
    ? `Download ${spec.symbol} · ${spec.days} days`
    : `${spec.secondPosition ? "Two positions" : "One position"} · ${spec.direction} · risk ${spec.money?.riskPct}%${(spec.money?.slots ?? 1) > 1 ? ` in ${spec.money?.slots} slots` : ""}`;
  return (
    <article className="panel p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <span className={`text-xs font-semibold ${job.status === "FAILED" ? "text-down" : job.status === "DONE" ? "text-ink-3" : "text-amber"}`}>
          {job.status === "QUEUED" ? "Waiting" : job.status === "RUNNING" ? "Running…" : job.status === "FAILED" ? "Failed" : new Date(job.finishedAt ?? job.createdAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"}
        </span>
      </header>
      {job.status === "FAILED" && <p className="mt-2 text-sm text-down">{job.error}</p>}
      {job.status === "DONE" && job.kind === "FETCH" && <p className="mt-2 text-sm text-ink-2">Stored {((job.result as { bars: number }).bars).toLocaleString("en-US")} bars.</p>}
      {job.status === "DONE" && job.kind === "STUDY" && <StudyView r={job.result as StudyResult} />}
    </article>
  );
}

function StudyView({ r }: { r: StudyResult }) {
  const f = r.account.full;
  const rb = r.account.robust;
  const stat = (k: string, v: string, tone = "text-ink") => (
    <div><dt className="label-caps">{k}</dt><dd className={`num mt-1 text-base font-semibold ${tone}`}>{v}</dd></div>
  );
  const tone = (x: number) => (x > 0 ? "text-up" : x < 0 ? "text-down" : "text-ink");
  return (
    <div className="mt-3 space-y-4">
      <p className="text-xs text-ink-3">{r.dataset.symbol} · {day(r.dataset.fromAt)} → {day(r.dataset.toAt)} · 1 candle = {r.unit.toPrecision(3)} · cost {r.cost.toPrecision(3)} per position</p>
      <div className="space-y-1.5 text-sm leading-relaxed text-ink">{r.verdict.map((v) => <p key={v}>{v}</p>)}</div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stat("Return", pct(f.returnPct), tone(f.returnPct))}
        {stat("Max fall (open incl.)", `${f.maxDdMtmPct.toFixed(1)}%`, f.maxDdMtmPct > 20 ? "text-down" : "text-ink")}
        {stat("Trades", f.trades.toLocaleString("en-US"))}
        {stat("Win rate", f.winRate == null ? "—" : `${Math.round(f.winRate * 100)}%`)}
        {stat("Profit factor", f.profitFactor == null ? "—" : f.profitFactor.toFixed(2))}
        {stat("Re-runs positive", rb ? `${Math.round(rb.returnPct.positiveShare * rb.runs)} / ${rb.runs}` : "—", rb && rb.returnPct.positiveShare < 0.8 ? "text-down" : "text-ink")}
      </dl>
      {rb && <RangeBar min={rb.returnPct.min} median={rb.returnPct.median} max={rb.returnPct.max} />}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Curve curve={f.curve} />
        <table className="self-start text-sm">
          <caption className="label-caps pb-1 text-left">By year</caption>
          <tbody>
            {Object.entries(f.perYear).map(([y, v]) => (
              <tr key={y} className="border-t border-line"><td className="py-1 pr-6 text-ink-2">{y}</td><td className={`num py-1 text-right ${tone(v)}`}>{pct(v)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Worst · median · best return across the random re-runs, on a scale that always includes 0. */
function RangeBar({ min, median, max }: { min: number; median: number; max: number }) {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const span = hi - lo || 1;
  const at = (x: number) => ((x - lo) / span) * 100;
  return (
    <figure>
      <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-6 w-full" role="img" aria-label={`Re-runs: worst ${pct(min)}, median ${pct(median)}, best ${pct(max)}`}>
        <rect x={0} y={2.5} width={100} height={1} className="fill-wash" />
        <rect x={at(min)} y={2} width={Math.max(0.5, at(max) - at(min))} height={2} rx={0.5} className="fill-line-2" />
        <rect x={at(0) - 0.15} y={0} width={0.3} height={6} className="fill-ink-3" />
        <rect x={at(median) - 0.6} y={0.5} width={1.2} height={5} rx={0.3} className={median >= 0 ? "fill-up" : "fill-down"} />
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-ink-3"><span>worst {pct(min)}</span><span>median {pct(median)}</span><span>best {pct(max)}</span></figcaption>
    </figure>
  );
}

/** Balance after each close (full run), as a plain line. */
function Curve({ curve }: { curve: Array<[number, number]> }) {
  if (curve.length < 2) return <p className="text-sm text-ink-3">Not enough trades for a curve.</p>;
  const W = 600, H = 160;
  const xs = curve.map((c) => c[0]), ys = curve.map((c) => c[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys, 1000), y1 = Math.max(...ys, 1000);
  const px = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W;
  const py = (y: number) => H - ((y - y0) / (y1 - y0 || 1)) * H;
  const d = curve.map((c, i) => `${i ? "L" : "M"}${px(c[0]).toFixed(1)},${py(c[1]).toFixed(1)}`).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label={`Balance from $1,000 to $${Math.round(ys[ys.length - 1]).toLocaleString("en-US")}`}>
        <line x1={0} x2={W} y1={py(1000)} y2={py(1000)} className="stroke-line-2" strokeDasharray="4 4" />
        <path d={d} fill="none" className={ys[ys.length - 1] >= 1000 ? "stroke-up" : "stroke-down"} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="label-caps">Balance after each trade (start $1,000)</figcaption>
    </figure>
  );
}
