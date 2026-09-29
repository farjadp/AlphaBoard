"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { ASSET_CATALOG, CATEGORY_LABELS, type AssetCategory } from "@/lib/assetCatalog";
import { createResource, useResource } from "@/lib/client/resource";
import { startSessionRequest } from "@/hooks/useSessions";
import { durationText } from "./ui";
import { exchangesResource } from "@/components/settings/ExchangeSettings";

type AiView = { models: Array<{ provider: string; id: string; label: string }>; providers: Array<{ id: string; configured: boolean }>; effective: { label: string } | null };
const aiResource = createResource<AiView | null>("/api/settings/ai", { fallback: null, select: (j) => j as AiView });

const DURATIONS = [30, 60, 120, 240, 480, 720, 1440];
const INTERVALS = [5, 10, 15, 30, 60, 120, 240];
const CATEGORIES: AssetCategory[] = ["crypto", "commodities", "forex", "indices"];

const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm tabular-nums text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
const label = "block text-xs font-medium text-ink-2";
const hint = "mt-1 text-[11px] text-ink-3";

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <fieldset className="panel p-5">
      <legend className="sr-only">{title}</legend>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-ink-3">{sub}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

function Num({ id, text, value, onChange, help, step = "any", disabled = false }: { id: string; text: string; value: string; onChange: (v: string) => void; help?: string; step?: string; disabled?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      <input id={id} type="number" inputMode="decimal" step={step} className={`${field} mt-1 disabled:bg-wash disabled:text-ink-3`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      {help && <p className={hint}>{help}</p>}
    </div>
  );
}

export default function MandateForm() {
  const router = useRouter();
  const ai = useResource(aiResource).data;
  const exchanges = useResource(exchangesResource).data;
  const [venue, setVenue] = useState("paper");
  const [confirmLive, setConfirmLive] = useState("");
  const [name, setName] = useState("");
  const [symbols, setSymbols] = useState<string[]>(["BTC/USDT", "ETH/USDT"]);
  const [marketType, setMarketType] = useState<"spot" | "swap">("spot");
  const [capital, setCapital] = useState("100");
  const [maxLeverage, setMaxLeverage] = useState("3");
  const [riskPct, setRiskPct] = useState("1");
  const [maxPositionPct, setMaxPositionPct] = useState("50");
  const [maxOpen, setMaxOpen] = useState("2");
  const [maxTrades, setMaxTrades] = useState("6");
  const [lossLimit, setLossLimit] = useState("10");
  const [duration, setDuration] = useState(480);
  const [interval, setIntervalMin] = useState(30);
  const [cooldown, setCooldown] = useState("30");
  const [onEnd, setOnEnd] = useState<"CLOSE_ALL" | "KEEP_WITH_STOPS">("CLOSE_ALL");
  const [extensionTimeout, setExtensionTimeout] = useState("5");
  const [debate, setDebate] = useState(false);
  const [maxCost, setMaxCost] = useState("1");
  const [models, setModels] = useState({ analyst: "", strategist: "", journal: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const usableConnections = (exchanges?.allowed ? exchanges.connections : []).filter((c) => c.status === "OK");
  const conn = usableConnections.find((c) => c.id === venue) ?? null;
  const effectiveMarket = conn ? conn.marketType : marketType;
  const configured = useMemo(() => new Set((ai?.providers ?? []).filter((p) => p.configured).map((p) => p.id)), [ai]);
  const usable = (ai?.models ?? []).filter((m) => configured.has(m.provider));
  const cycles = Math.max(1, Math.floor(duration / interval));
  const callsPerCycle = 3 + (debate ? 1 : 0);
  const toggle = (s: string) => setSymbols((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : cur.length >= 10 ? cur : [...cur, s]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const ref = (v: string) => (v ? { provider: v.split("::")[0], model: v.split("::")[1] } : null);
    const mandate = {
      venue: conn ? "exchange" : "paper", connectionId: conn?.id ?? null,
      symbols, marketType: effectiveMarket, capital: Number(capital), maxLeverage: effectiveMarket === "spot" ? 1 : Number(maxLeverage),
      riskPerTradePct: Number(riskPct), maxPositionPct: Number(maxPositionPct), maxOpenPositions: Number(maxOpen), maxTrades: Number(maxTrades),
      lossLimit: Number(lossLimit), durationMin: duration, decisionIntervalMin: interval, cooldownMin: Number(cooldown), onEnd,
      extensionTimeoutMin: Number(extensionTimeout), debate, maxLlmCostUsd: Number(maxCost),
      models: { analyst: ref(models.analyst), strategist: ref(models.strategist), journal: ref(models.journal) },
    };
    if (!symbols.length) { setError("Pick at least one symbol."); return; }
    setBusy(true);
    try {
      if (conn && !conn.sandbox && confirmLive !== "LIVE") { setError("Type LIVE to start a real-money session."); setBusy(false); return; }
      const v = await startSessionRequest({ name: name.trim() || undefined, mandate, confirmLive: conn && !conn.sandbox ? confirmLive : undefined });
      router.push(`/sessions/${v.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the session");
      setBusy(false);
    }
  }

  const modelSelect = (role: "analyst" | "strategist" | "journal", text: string, help: string) => (
    <div>
      <label htmlFor={`model-${role}`} className={label}>{text}</label>
      <select id={`model-${role}`} className={`${field} mt-1`} value={models[role]} onChange={(e) => setModels((m) => ({ ...m, [role]: e.target.value }))}>
        <option value="">Default{ai?.effective ? ` (${ai.effective.label})` : ""}</option>
        {usable.map((m) => <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>{m.label}</option>)}
      </select>
      <p className={hint}>{help}</p>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-page">
      <NavBar />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <form onSubmit={submit} className="mx-auto max-w-5xl space-y-5">
          <header>
            <Link href="/sessions" className="text-xs text-ink-3 hover:text-ink">← Sessions</Link>
            <h1 className="mt-1 font-display text-2xl font-bold text-ink">New session</h1>
            <p className="mt-1 text-sm text-ink-3">The mandate is fixed once the session starts. Every limit below is enforced by code, not by the AI.</p>
          </header>

          <Section title="Venue" sub="Paper simulates fills at live prices. An exchange connection sends real orders — testnet or real money.">
            <div className="sm:col-span-2">
              <label htmlFor="venue" className={label}>Trade on</label>
              <select id="venue" className={`${field} mt-1`} value={venue} onChange={(e) => { setVenue(e.target.value); setConfirmLive(""); }}>
                <option value="paper">Paper (simulated)</option>
                {usableConnections.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.exchange} {c.marketType === "swap" ? "perpetual" : "spot"} · {c.sandbox ? "testnet" : "REAL MONEY"}</option>)}
              </select>
              <p className={hint}>
                {exchanges && !exchanges.allowed ? `Exchanges: ${exchanges.reason}.` : usableConnections.length ? "Only tested connections are listed." : "Add and test a connection in Settings to trade on an exchange."}
              </p>
            </div>
            {conn && !conn.sandbox && (
              <div className="sm:col-span-2 lg:col-span-3 rounded-lg border border-down/30 bg-down-soft p-3">
                <label htmlFor="confirm-live" className="block text-sm font-semibold text-down">Real money. Type LIVE to confirm.</label>
                <p className="mt-0.5 text-xs text-ink-2">Orders go to {conn.exchange} with your funds. Stops are software stops checked every 15 seconds; if the server stops, positions are unprotected.</p>
                <input id="confirm-live" className={`${field} mt-2 max-w-40 font-mono uppercase`} value={confirmLive} onChange={(e) => setConfirmLive(e.target.value.toUpperCase())} autoComplete="off" />
              </div>
            )}
          </Section>

          <Section title="Market" sub={conn ? `Orders map to ${conn.exchange} symbols quoted in ${conn.quote}. Crypto only on exchanges.` : "What the desk may trade. Paper fills at live prices with fees and slippage."}>
            <div className="sm:col-span-2 lg:col-span-3">
              <p className={label} id="symbols-label">Symbols <span className="text-ink-3">({symbols.length}/10)</span></p>
              <div role="group" aria-labelledby="symbols-label" className="mt-2 space-y-3">
                {CATEGORIES.filter((c) => !conn || c === "crypto").map((c) => (
                  <div key={c}>
                    <p className="label-caps mb-1.5">{CATEGORY_LABELS[c]}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ASSET_CATALOG.filter((a) => a.category === c).map((a) => {
                        const on = symbols.includes(a.symbol);
                        return (
                          <button key={a.symbol} type="button" aria-pressed={on} onClick={() => toggle(a.symbol)}
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-2 hover:border-line-2"}`}>
                            {a.symbol}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className={label} id="market-label">Market type</p>
              <div role="radiogroup" aria-labelledby="market-label" className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-wash p-1">
                {(["spot", "swap"] as const).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={effectiveMarket === t} disabled={!!conn} onClick={() => setMarketType(t)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed ${effectiveMarket === t ? "bg-paper text-ink shadow-sm" : "text-ink-3"}`}>
                    {t === "spot" ? "Spot" : "Perpetual"}
                  </button>
                ))}
              </div>
              <p className={hint}>{effectiveMarket === "spot" ? "Long only, no leverage." : "Long and short, isolated margin."}{conn ? " Set by the connection." : ""}</p>
            </div>
            <Num id="leverage" text="Max leverage" value={effectiveMarket === "spot" ? "1" : maxLeverage} onChange={setMaxLeverage} step="1" disabled={effectiveMarket === "spot"} help="Stops beyond the liquidation price are refused." />
            <div>
              <label htmlFor="name" className={label}>Name <span className="text-ink-3">(optional)</span></label>
              <input id="name" className={`${field} mt-1`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. BTC morning test" />
            </div>
          </Section>

          <Section title="Capital and risk" sub="Sizes come from the stop distance: a stop twice as far means half the size.">
            <Num id="capital" text={`Session capital (${conn ? conn.quote : "$"})`} value={capital} onChange={setCapital} help={conn ? `Must not exceed your free ${conn.quote} balance.` : "Simulated; 10 to 10,000,000."} />
            <Num id="risk" text="Risk per trade (%)" value={riskPct} onChange={setRiskPct} help="Loss at the stop, as % of equity." />
            <Num id="maxpos" text="Max position (% of capital)" value={maxPositionPct} onChange={setMaxPositionPct} help="Margin cap per position." />
            <Num id="loss" text="Session loss limit ($)" value={lossLimit} onChange={setLossLimit} help="Hit → everything closes and trading stops." />
            <Num id="maxopen" text="Max open positions" value={maxOpen} onChange={setMaxOpen} step="1" />
            <Num id="maxtrades" text="Max trades" value={maxTrades} onChange={setMaxTrades} step="1" help="New entries for the whole session." />
            <Num id="cooldown" text="Cooldown after a stop (min)" value={cooldown} onChange={setCooldown} step="1" help="No re-entry on that symbol meanwhile." />
          </Section>

          <Section title="Time" sub="At the end you get a prompt (web and Telegram). No answer in time → the end action runs.">
            <div>
              <label htmlFor="duration" className={label}>Session length</label>
              <select id="duration" className={`${field} mt-1`} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((d) => <option key={d} value={d}>{durationText(d)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="interval" className={label}>Decide every</label>
              <select id="interval" className={`${field} mt-1`} value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}>
                {INTERVALS.map((d) => <option key={d} value={d}>{durationText(d)}</option>)}
              </select>
              <p className={hint}>Big moves and closed trades trigger an earlier cycle.</p>
            </div>
            <Num id="exttimeout" text="Answer window at the end (min)" value={extensionTimeout} onChange={setExtensionTimeout} step="1" />
            <div className="sm:col-span-2 lg:col-span-3">
              <p className={label} id="onend-label">If there is no answer</p>
              <div role="radiogroup" aria-labelledby="onend-label" className="mt-1 flex flex-wrap gap-2">
                {([["CLOSE_ALL", "Close all positions"], ["KEEP_WITH_STOPS", "Keep positions with their stops"]] as const).map(([v, t]) => (
                  <button key={v} type="button" role="radio" aria-checked={onEnd === v} onClick={() => setOnEnd(v)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${onEnd === v ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-2"}`}>{t}</button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Agents and cost" sub="Analysts read the market and news; the strategist proposes; the journal writes lessons and the report.">
            {modelSelect("analyst", "Analysts' model", "Two calls per cycle — a cheap model is fine.")}
            {modelSelect("strategist", "Strategist's model", "One call per cycle (plus the debate).")}
            {modelSelect("journal", "Journal's model", "One call per closed trade and the report.")}
            <div className="flex items-start gap-2">
              <input id="debate" type="checkbox" checked={debate} onChange={(e) => setDebate(e.target.checked)} className="mt-1 size-4 accent-accent" />
              <label htmlFor="debate" className="text-sm text-ink-2">Bull vs bear debate before each decision<span className="block text-[11px] text-ink-3">One extra call per cycle.</span></label>
            </div>
            <Num id="maxcost" text="AI budget ($)" value={maxCost} onChange={setMaxCost} help="When reached, no more cycles; stops keep running." />
            <div className="rounded-lg bg-wash p-3 text-xs text-ink-2">
              <p className="num">≈ {cycles} cycles · up to {cycles * callsPerCycle} AI calls</p>
              <p className="mt-1 text-ink-3">Quiet markets skip calls; the budget is a hard stop.</p>
            </div>
          </Section>

          {error && <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-3 pb-6">
            <Link href="/sessions" className="text-sm text-ink-3 hover:text-ink">Cancel</Link>
            <button type="submit" disabled={busy} className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-ink-hover disabled:opacity-60">
              {busy ? "Starting…" : conn ? (conn.sandbox ? "Start testnet session" : "Start LIVE session") : "Start paper session"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
