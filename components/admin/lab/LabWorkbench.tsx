"use client";
import { signedPct } from "@/lib/format";

import { useEffect, useState } from "react";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";
import type { DatasetDto } from "@/lib/lab/data/store";
import type { LabJobDto } from "@/lib/lab/jobs";
import type { LadderStudyResult } from "@/lib/lab/study";
import type { EdgeResult } from "@/lib/lab/edge";
import type { Mt5TradeDto } from "@/lib/mt5/import";
import type { BasketDto } from "@/lib/lab/data/basket";
import type { DcaStudyResult } from "@/lib/lab/dcaStudy";

const datasetsRes = createResource<DatasetDto[]>("/api/admin/lab/datasets", { fallback: [], select: (j) => (j as { datasets: DatasetDto[] }).datasets });
const basketsRes = createResource<BasketDto[]>("/api/admin/lab/baskets", { fallback: [], select: (j) => (j as { baskets: BasketDto[] }).baskets });
const tradesRes = createResource<Mt5TradeDto[]>("/api/admin/lab/trades", { fallback: [], select: (j) => (j as { trades: Mt5TradeDto[] }).trades });
const jobsRes = createResource<LabJobDto[]>("/api/admin/lab/jobs", { fallback: [], select: (j) => (j as { jobs: LabJobDto[] }).jobs });

const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";
const label = "mb-1 block text-xs font-semibold text-ink-2";
const hint = "mt-1 text-xs text-ink-3";
const btn = "rounded-lg bg-ink px-4 py-2 text-sm font-bold text-paper hover:bg-ink-hover disabled:opacity-50";
const day = (iso: string) => iso.slice(0, 10);
const pct = (x: number, d = 1) => signedPct(x, d);

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
    const t = setInterval(() => { void jobsRes.load(true); void datasetsRes.load(true); void basketsRes.load(true); }, 3_000);
    return () => clearInterval(t);
  }, [active]);

  return (
    <div className="space-y-8">
      <DataPanel {...props} />
      <StudyForm />
      <BasketPanel />
      <Results jobs={jobs.data} error={jobs.error} />
      <YourTrades />
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
  const dca = job.spec as { slots?: number; dropPct?: number; stopLossPct?: number | null; listedBy?: string; from?: string };
  const title = job.kind === "FETCH"
    ? `Download ${spec.symbol} · ${spec.days} days`
    : job.kind === "BASKET"
      ? `Build a coin basket · listed by ${dca.listedBy} · from ${dca.from}`
      : job.kind === "DCA"
        ? `DCA ladder · ${dca.slots} slots · buy after −${dca.dropPct}%${dca.stopLossPct ? ` · stop ${dca.stopLossPct}%` : " · no stop"}`
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
      {job.status === "DONE" && job.kind === "BASKET" && <p className="mt-2 text-sm text-ink-2">Stored {(job.result as { symbols: number }).symbols} coins{(job.result as { missing: string[] }).missing.length ? ` (${(job.result as { missing: string[] }).missing.length} had no data in range)` : ""}.</p>}
      {job.status === "DONE" && job.kind === "DCA" && <DcaView r={job.result as DcaStudyResult} />}
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

/* ───────────────────────────── your trades (MT5) ───────────────────────────── */

function YourTrades() {
  const { data: trades, error } = useResource(tradesRes);
  const { data: datasets } = useResource(datasetsRes);
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [who, setWho] = useState("manual");
  const [edge, setEdge] = useState<EdgeResult | null>(null);
  const sym = symbol || symbols[0] || "";
  const ds = datasetId || datasets.find((d) => d.timeframe === "1m")?.id || "";

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const r = await tradesRes.mutate<{ imported: number; alreadyThere: number; stillOpen: number }>({ request: () => fetch("/api/admin/lab/trades", { method: "POST", body: fd, credentials: "same-origin" }) });
      await tradesRes.load(true);
      setMsg(`Imported ${r.imported} closed trades${r.alreadyThere ? ` (${r.alreadyThere} were already here)` : ""}${r.stillOpen ? `; ${r.stillOpen} still open, skipped` : ""}. They are in the journal too.`);
      setFile(null);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setBusy(false); }
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setEdge(null);
    try {
      const res = await fetch("/api/admin/lab/edge", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sym, datasetId: ds, who }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed");
      setEdge(body.result as EdgeResult);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setBusy(false); }
  }

  const bySymbol = symbols.map((s) => {
    const list = trades.filter((t) => t.symbol === s);
    return { s, n: list.length, manual: list.filter((t) => t.manual).length, net: list.reduce((a, t) => a + t.net, 0), ccy: list[0]?.currency ?? "" };
  });

  return (
    <section aria-labelledby="lab-trades" className="panel space-y-5 p-5">
      <div>
        <h2 id="lab-trades" className="font-display text-lg font-bold text-ink">Your trades</h2>
        <p className="mt-1 text-sm text-ink-2">Import your MetaTrader history and check whether your entries beat random entries — same market, side, stop and holding time.</p>
      </div>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="lab-deals" className={label}>ExportDeals CSV</label>
          <input id="lab-deals" type="file" accept=".csv,text/csv" className="block text-sm text-ink-2 file:mr-3 file:rounded-lg file:border-0 file:bg-wash file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className={hint}>From MetaTrader: Scripts → ExportDeals. Only closed trades are imported; importing again adds only new ones.</p>
        </div>
        <button type="submit" disabled={busy || !file} className={btn}>Import</button>
      </form>
      {bySymbol.length > 0 && (
        <table className="text-sm">
          <thead className="text-left text-xs text-ink-3"><tr><th className="p-2 font-medium">Symbol</th><th className="p-2 text-right font-medium">Trades</th><th className="p-2 text-right font-medium">By hand</th><th className="p-2 text-right font-medium">Net</th></tr></thead>
          <tbody>{bySymbol.map((r) => (
            <tr key={r.s} className="border-t border-line"><td className="p-2 font-semibold text-ink">{r.s}</td><td className="num p-2 text-right">{r.n}</td><td className="num p-2 text-right">{r.manual}</td><td className={`num p-2 text-right ${r.net >= 0 ? "text-up" : "text-down"}`}>{r.net >= 0 ? "+" : "−"}{Math.abs(r.net).toFixed(2)} {r.ccy}</td></tr>
          ))}</tbody>
        </table>
      )}
      {symbols.length > 0 && (
        <form onSubmit={check} className="grid gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="edge-sym" className={label}>Trades on</label>
            <select id="edge-sym" className={field} value={sym} onChange={(e) => setSymbol(e.target.value)}>{symbols.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </div>
          <div>
            <label htmlFor="edge-ds" className={label}>Compare on data</label>
            <select id="edge-ds" className={field} value={ds} onChange={(e) => setDatasetId(e.target.value)}>
              {datasets.filter((d) => d.timeframe === "1m").map((d) => <option key={d.id} value={d.id}>{d.symbol} · {day(d.fromAt)} → {day(d.toAt)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="edge-who" className={label}>Which trades</label>
            <select id="edge-who" className={field} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="manual">By hand</option>
              <option value="expert">By an expert</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="flex items-end"><button type="submit" disabled={busy || !ds} className={btn}>{busy ? "Checking…" : "Check my edge"}</button></div>
        </form>
      )}
      {msg && <p role="status" className="text-sm text-ink-2">{msg}</p>}
      {edge && (
        <div className="space-y-3 rounded-lg border border-line p-4">
          <div className="space-y-1.5 text-sm leading-relaxed text-ink">{edge.verdict.map((v) => <p key={v}>{v}</p>)}</div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><dt className="label-caps">Your average</dt><dd className="num mt-1 font-semibold">{edge.avgR == null ? "—" : `${edge.avgR.toFixed(2)}R`}</dd></div>
            <div><dt className="label-caps">Random entries</dt><dd className="num mt-1 font-semibold">{edge.baselineAvgR == null ? "—" : `${edge.baselineAvgR.toFixed(2)}R`}</dd></div>
            <div><dt className="label-caps">Your win rate</dt><dd className="num mt-1 font-semibold">{edge.winRate == null ? "—" : `${Math.round(edge.winRate * 100)}%`}</dd></div>
            <div><dt className="label-caps">Trades compared</dt><dd className="num mt-1 font-semibold">{edge.used} of {edge.trades}</dd></div>
          </dl>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── crypto basket (DCA ladder) ───────────────────────────── */

function BasketPanel() {
  const { data: baskets } = useResource(basketsRes);
  const [listedBy, setListedBy] = useState("2022-01");
  const [from, setFrom] = useState("2021-01");
  const [basketId, setBasketId] = useState("");
  const chosen = basketId || baskets[0]?.id || "";
  const [start, setStart] = useState("2021-01-01");
  const [slots, setSlots] = useState("15");
  const [deep, setDeep] = useState("10");
  const [drop, setDrop] = useState("3");
  const [d1, setD1] = useState("9");
  const [d2, setD2] = useState("19.5");
  const [tp0, setTp0] = useState("1.5");
  const [tp1, setTp1] = useState("1");
  const [stop, setStop] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function build(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await jobsRes.mutate({ request: jsonRequest("/api/admin/lab/jobs", "POST", { kind: "basket", listedBy, from }) });
      await jobsRes.load(true);
      setMsg("Building — a few minutes for 100+ coins. It appears in the results when done.");
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setBusy(false); }
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await jobsRes.mutate({
        request: jsonRequest("/api/admin/lab/jobs", "POST", {
          kind: "dca", basketId: chosen, start, slots: Number(slots), deepSlots: Number(deep), dropPct: Number(drop), d1Pct: Number(d1), d2Pct: Number(d2),
          tp0Pct: Number(tp0), tp1Pct: Number(tp1), stopLossPct: stop.trim() ? Number(stop) : null,
        }),
      });
      await jobsRes.load(true);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this basket?")) return;
    await basketsRes.mutate({ optimistic: (d) => d.filter((x) => x.id !== id), request: jsonRequest(`/api/admin/lab/baskets/${id}`, "DELETE") }).catch(() => undefined);
  }

  return (
    <section aria-labelledby="lab-basket" className="panel space-y-5 p-5">
      <div>
        <h2 id="lab-basket" className="font-display text-lg font-bold text-ink">Crypto basket · DCA ladder</h2>
        <p className="mt-1 text-sm text-ink-2">Long-only buying after a drop, adding lower, selling a little above the average — the bot family that shows a green profit calendar. Tested on every Binance USD-M coin that was listed at a chosen month, including the ones later delisted, so the result is not flattered by survivors.</p>
      </div>
      {baskets.length > 0 && (
        <ul className="space-y-1 text-sm">
          {baskets.map((b) => (
            <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-1">
              <span className="text-ink">{b.name} · <span className="num">{b.symbols}</span> coins · {day(b.fromAt)} → {day(b.toAt)}</span>
              <button type="button" onClick={() => void remove(b.id)} className="text-xs font-semibold text-ink-3 hover:text-down">Delete</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={build} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="bk-listed" className={label}>Coins listed by</label>
          <input id="bk-listed" type="month" className={field} value={listedBy} onChange={(e) => setListedBy(e.target.value)} />
        </div>
        <div>
          <label htmlFor="bk-from" className={label}>Prices from</label>
          <input id="bk-from" type="month" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <button type="submit" disabled={busy} className={btn}>Build basket</button>
      </form>
      {baskets.length > 0 && (
        <form onSubmit={run} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="dca-b" className={label}>Basket</label>
              <select id="dca-b" className={field} value={chosen} onChange={(e) => setBasketId(e.target.value)}>
                {baskets.map((b) => <option key={b.id} value={b.id}>{b.symbols} coins · {day(b.fromAt)} → {day(b.toAt)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="dca-start" className={label}>Start on</label>
              <input id="dca-start" type="date" className={field} value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <Num id="dca-slots" text="Coins held at once" value={slots} onChange={setSlots} step="1" />
            <Num id="dca-deep" text="…of which may add twice" value={deep} onChange={setDeep} step="1" />
            <Num id="dca-drop" text="Buy after a drop of (%)" value={drop} onChange={setDrop} help="From the 24-hour high." />
            <Num id="dca-d1" text="First add at (−%)" value={d1} onChange={setD1} />
            <Num id="dca-d2" text="Second add at (−%)" value={d2} onChange={setD2} />
            <Num id="dca-tp0" text="Take profit (%)" value={tp0} onChange={setTp0} help="Over the average buy price." />
            <Num id="dca-tp1" text="Take profit after an add (%)" value={tp1} onChange={setTp1} />
            <Num id="dca-stop" text="Stop under the average (%)" value={stop} onChange={setStop} help="Empty = no stop (the original)." />
          </div>
          <button type="submit" disabled={busy || !chosen} className={btn}>Run DCA test</button>
        </form>
      )}
      {msg && <p role="status" className="text-sm text-ink-2">{msg}</p>}
    </section>
  );
}

function DcaView({ r }: { r: DcaStudyResult & { basket?: BasketDto } }) {
  const tone = (x: number) => (x > 0 ? "text-up" : x < 0 ? "text-down" : "text-ink");
  const stat = (k: string, v: string, t = "text-ink") => <div><dt className="label-caps">{k}</dt><dd className={`num mt-1 text-base font-semibold ${t}`}>{v}</dd></div>;
  const ret = (r.finalBalance / 1000 - 1) * 100;
  return (
    <div className="mt-3 space-y-4">
      <div className="space-y-1.5 text-sm leading-relaxed text-ink">{r.verdict.map((v) => <p key={v}>{v}</p>)}</div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stat("Return", pct(ret), tone(ret))}
        {stat("Max fall, open positions", `${r.maxDdMtmPct.toFixed(1)}%`, r.maxDdMtmPct > 30 ? "text-down" : "text-ink")}
        {stat("Max fall, closed trades only", `${r.maxDdRealizedPct.toFixed(1)}%`)}
        {stat("Ladders closed", r.episodes.toLocaleString("en-US"))}
        {stat("Slots in use", `${Math.round((r.avgSlots / r.slots) * 100)}%`)}
      </dl>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <TwoCurves mtm={r.curves.mtm} realized={r.curves.realized} />
        <table className="self-start text-sm">
          <caption className="label-caps pb-1 text-left">By year</caption>
          <tbody>{Object.entries(r.perYear).map(([y, v]) => (
            <tr key={y} className="border-t border-line"><td className="py-1 pr-6 text-ink-2">{y}</td><td className={`num py-1 text-right ${tone(v)}`}>{pct(v)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

/** Equity marked to market vs the same account counted on closed trades only (open positions at cost). */
function TwoCurves({ mtm, realized }: { mtm: Array<[number, number]>; realized: Array<[number, number]> }) {
  if (mtm.length < 2) return <p className="text-sm text-ink-3">Not enough data for a curve.</p>;
  const W = 600, H = 180;
  const all = [...mtm, ...realized];
  const x0 = mtm[0][0], x1 = mtm[mtm.length - 1][0];
  const ys = all.map((p) => p[1]);
  const y0 = Math.min(...ys, 1000), y1 = Math.max(...ys, 1000);
  const px = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W;
  const py = (y: number) => H - ((y - y0) / (y1 - y0 || 1)) * H;
  const path = (c: Array<[number, number]>) => c.map((p, i) => `${i ? "L" : "M"}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Account value with open positions marked to market, and counted on closed trades only">
        <line x1={0} x2={W} y1={py(1000)} y2={py(1000)} className="stroke-line-2" strokeDasharray="4 4" />
        <path d={path(realized)} fill="none" className="stroke-ink-3" strokeWidth={1.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
        <path d={path(mtm)} fill="none" className="stroke-down" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 text-xs text-ink-3">
        <span><span className="font-bold text-down">━</span> real value, open positions at market</span>
        <span><span className="font-bold text-ink-3">┅</span> closed trades only (what a profit calendar shows)</span>
      </figcaption>
    </figure>
  );
}
