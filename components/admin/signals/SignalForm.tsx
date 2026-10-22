"use client";

import { useState } from "react";
import { checkSignal, signalInput } from "@/lib/signals/validate";
import { formatSignalPost } from "@/lib/signals/format";
import { num } from "@/lib/signals/num";
import { matchSymbol, type SignalDraft } from "@/lib/signals/importDraft";
import { PasteBox } from "./PasteBox";
import { useResource } from "@/lib/client/resource";
import { btn, btnQuiet, field, hint, isOnline, label, signalsRes, templateRes, type DeviceDto } from "./resources";

const TP_SLOTS = 4;

/** "" → null; anything else must be a number. */
function price(raw: string, name: string, errs: string[]): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) errs.push(`${name} is not a number`);
  return Number.isFinite(n) ? n : null;
}

export function SignalForm({ terminal, channelOn }: { terminal: DeviceDto | null; channelOn: boolean }) {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [tps, setTps] = useState<string[]>(Array(TP_SLOTS).fill(""));
  const [risk, setRisk] = useState("0.5");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  /** Set by "Paste a signal" from an entry zone; cleared when the entry is edited by hand. */
  const [maxDev, setMaxDev] = useState<number | null>(null);
  const [imported, setImported] = useState<string[] | null>(null);
  const [levels, setLevels] = useState<{ ok: boolean; notes: string[] } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [execute, setExecute] = useState(true);
  const [post, setPost] = useState(channelOn);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);

  const errs: string[] = [];
  const entryN = price(entry, "Entry", errs);
  const stopN = price(stop, "Stop", errs);
  const tpN = tps.map((t, i) => price(t, `TP${i + 1}`, errs)).filter((x): x is number => x != null);
  const riskN = price(risk, "Risk", errs);
  // "XAUUSD", "gold", "XAU/USD" → the terminal's own name ("XAUUSD.ec"), so the broker suffix never has to be typed.
  const mapped = symbol.trim() && terminal?.symbols.length ? matchSymbol(symbol, terminal.symbols) : null;
  const effSymbol = mapped ?? symbol;
  const raw = { symbol: effSymbol, side, entry: entryN, stop: stopN ?? undefined, tps: tpN, riskPct: riskN ?? undefined, note: note.trim() || null, source: source.trim() || null, maxDeviation: entryN == null ? null : maxDev, execute, post };
  const parsed = signalInput.safeParse(raw);
  if (execute && !terminal) errs.push("No terminal is connected: untick “Execute on MT5” to only post, or add a terminal");
  if (!symbol.trim()) errs.push("Pick a symbol");
  else if (stopN == null) errs.push("A stop is required");
  else if (!parsed.success) errs.push(...parsed.error.issues.map((i) => (i.path[0] === "riskPct" ? "Risk must be above 0 and at most 1%" : i.path[0] === "tps" ? "At most 4 targets" : i.message)));
  if (parsed.success) errs.push(...checkSignal(parsed.data, { symbols: terminal?.symbols ?? [], marketEntryOnServer: true }).filter((m) => terminal || !m.endsWith("terminal's symbol list")));
  const tpl = useResource(templateRes).data;
  const preview = parsed.success && errs.length === 0 ? formatSignalPost(parsed.data, tpl?.template, tpl?.channel ?? null) : null;
  // Rules are shown once prices are being typed, not for a form that was just reset.
  const typing = !!(entry || stop || tps.some(Boolean));

  const online = terminal ? isOnline(terminal) : false;

  function applyDraft(d: SignalDraft, warnings: string[]) {
    setSymbol(d.symbol);
    if (d.side) setSide(d.side);
    setEntry(d.entry == null ? "" : num(d.entry));
    setStop(d.stop == null ? "" : num(d.stop));
    setTps(Array.from({ length: TP_SLOTS }, (_, i) => (d.tps[i] == null ? "" : num(d.tps[i]))));
    setMaxDev(d.maxDeviation);
    setSource(d.source ?? "");
    setImported(warnings);
    setResult(null);
    setLevels(null);
    // The post gave only part of the plan: read the chart for what is missing, without touching what it gave.
    if (d.symbol && d.side && (d.stop == null || d.tps.length === 0)) {
      void suggest({ symbol: d.symbol, side: d.side, entry: d.entry }, { stop: d.stop == null, tps: d.tps.length === 0 });
    }
  }

  /** Stop and Fibonacci targets from live candles; `fill` says which fields to set (all of them from the button). */
  async function suggest(at: { symbol: string; side: "BUY" | "SELL"; entry: number | null }, fill = { stop: true, tps: true }) {
    setSuggesting(true); setLevels(null);
    try {
      const res = await fetch("/api/signal-desk/levels", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(at) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
      const r = body as { stop: number; tps: number[]; notes: string[] };
      if (fill.stop) setStop(num(r.stop));
      if (fill.tps) setTps(Array.from({ length: TP_SLOTS }, (_, i) => (r.tps[i] == null ? "" : num(r.tps[i]))));
      setLevels({ ok: true, notes: r.notes });
    } catch (err) {
      setLevels({ ok: false, notes: [err instanceof Error ? err.message : "Failed"] });
    } finally {
      setSuggesting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (errs.length || !parsed.success) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/signal-desk", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
      const s = body.signal as { channelError: string | null; execute: boolean };
      const lines = [s.execute ? "Sent to the terminal queue." : "Posted only; nothing will be executed."];
      if (s.channelError) lines.push(`Channel: ${s.channelError}`);
      lines.push(...(body.warnings as string[]));
      setResult({ ok: true, lines });
      setEntry(""); setStop(""); setTps(Array(TP_SLOTS).fill("")); setNote(""); setSource(""); setMaxDev(null); setImported(null); setLevels(null);
      await signalsRes.load(true);
    } catch (err) {
      setResult({ ok: false, lines: [err instanceof Error ? err.message : "Failed"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sd-new" className="panel space-y-5 p-5">
      <h2 id="sd-new" className="font-display text-lg font-bold text-ink">New signal</h2>
      <PasteBox onDraft={applyDraft} />
      {imported && (
        <div role="status" className="space-y-1 rounded-lg border border-amber bg-amber-soft p-3 text-sm text-ink">
          <p className="font-bold">Filled from the pasted signal. Check every field before sending.</p>
          {imported.map((w) => <p key={w} className="text-ink-2">{w}</p>)}
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor="sd-symbol" className={label}>Symbol</label>
            <input id="sd-symbol" className={field} list="sd-symbols" value={symbol} onChange={(e) => setSymbol(e.target.value.trim())} autoComplete="off" spellCheck={false} placeholder={terminal?.symbols[0] ?? "XAUUSD"} />
            <datalist id="sd-symbols">{terminal?.symbols.map((s) => <option key={s} value={s} />)}</datalist>
            <p className={hint}>
              {mapped && mapped !== symbol
                ? <>Sent as <span className="font-semibold text-ink">{mapped}</span> on {terminal?.label}</>
                : terminal ? `${terminal.symbols.length} symbols from ${terminal.label}` : "No terminal yet — add one on the right"}
            </p>
          </div>
          <div role="group" aria-labelledby="sd-side-label">
            <span id="sd-side-label" className={label}>Side</span>
            <div className="flex rounded-lg border border-line p-0.5">
              {(["BUY", "SELL"] as const).map((s) => (
                <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}
                  className={`rounded-md px-4 py-1.5 text-sm font-bold ${side === s ? (s === "BUY" ? "bg-up text-paper" : "bg-down text-paper") : "text-ink-2 hover:bg-wash"}`}>
                  {s === "BUY" ? "Long" : "Short"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="sd-entry" className={label}>Entry</label>
            <input id="sd-entry" className={`${field} num`} inputMode="decimal" value={entry} onChange={(e) => { setEntry(e.target.value); setMaxDev(null); }} placeholder="market" />
            <p className={hint}>{entry.trim() ? "Blank = market now" : execute ? "Market: the terminal fills at the live price" : "Market: posted at the live price when you send"}</p>
          </div>
          <div>
            <label htmlFor="sd-stop" className={label}>Stop</label>
            <input id="sd-stop" className={`${field} num`} inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} required aria-required="true" />
          </div>
          <div>
            <label htmlFor="sd-risk" className={label}>Risk %</label>
            <input id="sd-risk" className={`${field} num`} inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)} />
            <p className={hint}>Of balance, max 1%</p>
          </div>
        </div>

        <fieldset>
          <legend className="mb-1 flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-ink-2">Targets</span>
            <button type="button" className={btnQuiet} disabled={suggesting || !symbol.trim() || !!entry && entryN == null}
              onClick={() => suggest({ symbol, side, entry: entryN })}>
              {suggesting ? "Reading the chart…" : "Suggest stop & targets"}
            </button>
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tps.map((t, i) => (
              <input key={i} aria-label={`Target ${i + 1}`} className={`${field} num`} inputMode="decimal" value={t} placeholder={`TP${i + 1}`}
                onChange={(e) => setTps(tps.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
          </div>
          <p className={hint}>One position per target, each with its own take-profit at the broker. After TP1 the rest move to entry.</p>
          {levels && (
            <div role={levels.ok ? "status" : "alert"} className={`mt-2 space-y-1 rounded-lg p-3 text-sm ${levels.ok ? "bg-wash text-ink-2" : "text-down"}`}>
              {levels.ok && <p className="font-semibold text-ink">Suggested from the chart. A starting point, not a forecast: adjust before sending.</p>}
              {levels.notes.map((n) => <p key={n}>{n}</p>)}
            </div>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <div>
            <label htmlFor="sd-note" className={label}>Note for the channel</label>
            <input id="sd-note" className={field} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, one line" />
          </div>
          <div>
            <label htmlFor="sd-source" className={label}>Source</label>
            <input id="sd-source" className={field} maxLength={80} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Optional" />
            <p className={hint}>Not posted. Lets you compare results by source.</p>
          </div>
        </div>

        <div className="space-y-2 text-sm text-ink">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={post} onChange={(e) => setPost(e.target.checked)} />
            <span>Post to the channel{!channelOn && <span className="block text-xs text-amber">The channel bot is not configured on the server; the post will be skipped.</span>}</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={execute} onChange={(e) => setExecute(e.target.checked)} />
            <span>
              Execute on MT5
              {execute && terminal && (
                <span className={`block text-xs ${terminal.tradeMode === "REAL" ? "font-semibold text-down" : "text-ink-3"}`}>
                  {terminal.label} · {terminal.tradeMode === "REAL" ? "real-money account" : (terminal.tradeMode ?? "account unknown").toLowerCase()} · {online ? "online" : "offline — the signal waits 10 min"}
                </span>
              )}
            </span>
          </label>
        </div>

        {preview && (
          <div>
            <span className={label}>Channel preview</span>
            <pre dir="auto" className="whitespace-pre-wrap rounded-lg bg-wash p-3 font-sans text-sm leading-relaxed text-ink">{preview}</pre>
          </div>
        )}

        {errs.length > 0 && typing && (
          <ul className="space-y-1 text-sm text-down" aria-live="polite">{[...new Set(errs)].map((m) => <li key={m}>{m}</li>)}</ul>
        )}
        {result && (
          <div role={result.ok ? "status" : "alert"} className={`space-y-1 text-sm ${result.ok ? "text-ink-2" : "text-down"}`}>
            {result.lines.map((l) => <p key={l}>{l}</p>)}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={btn} disabled={busy || errs.length > 0} aria-describedby={errs.length && !typing ? "sd-why" : undefined}>{busy ? "Sending…" : execute ? "Send signal" : "Post signal"}</button>
          {errs.length > 0 && !typing && <p id="sd-why" className="text-sm text-ink-2">{errs[0]}</p>}
        </div>
      </form>
    </section>
  );
}
