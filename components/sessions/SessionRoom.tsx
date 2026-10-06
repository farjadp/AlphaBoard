"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import DeskTable from "@/components/sessions/DeskTable";
import DeskRoundTable from "@/components/sessions/DeskRoundTable";
import { CAST } from "@/lib/agents/cast";
import { useRoom, useSessionReport, useSessionView } from "@/hooks/useSessions";
import { price as fmtPrice, qty as fmtQty } from "@/components/paper/format";
import type { Mandate } from "@/lib/sessions/mandate";
import type { SessionMessageDto, SessionPositionDto, SessionViewDto } from "@/lib/types/sessions";
import { END_REASON, Meter, StatusPill, durationText, timeLeft, usd } from "./ui";

// ─── Clock (1 s) without setState in effects ─────────────────────────────────

const clock = {
  listeners: new Set<() => void>(),
  now: Date.now(),
  timer: null as ReturnType<typeof setInterval> | null,
  subscribe(l: () => void) {
    clock.listeners.add(l);
    if (!clock.timer) clock.timer = setInterval(() => { clock.now = Date.now(); clock.listeners.forEach((x) => x()); }, 1_000);
    return () => {
      clock.listeners.delete(l);
      if (!clock.listeners.size && clock.timer) { clearInterval(clock.timer); clock.timer = null; }
    };
  },
};
const useNow = () => useSyncExternalStore(clock.subscribe, () => clock.now, () => 0);

// ─── Room ────────────────────────────────────────────────────────────────────

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

function bubbleTone(m: SessionMessageDto) {
  const kind = (m.data as { kind?: string } | null)?.kind;
  if (m.kind === "VERDICT") return kind === "rejected" ? "border-down/30 bg-down-soft/40" : kind === "clamped" ? "border-amber/30 bg-amber-soft/50" : "border-up/30 bg-up-soft/40";
  if (m.kind === "PROPOSAL") return "border-ink/20 bg-paper";
  if (m.kind === "FILL") return "border-line bg-wash";
  if (m.kind === "ALERT") return "border-amber/40 bg-amber-soft";
  if (m.kind === "REPORT") return "border-accent/40 bg-accent-soft";
  if (m.role === "USER") return "border-ink/10 bg-ink/[0.04]";
  return "border-transparent bg-transparent";
}

function Message({ m }: { m: SessionMessageDto }) {
  const r = CAST[m.role];
  const boxed = m.kind !== "TEXT" || m.role === "USER";
  return (
    <li className="flex gap-3">
      <span aria-hidden className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${r.tone}`}>{r.badge}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-ink" title={r.title}>{r.name}</span>
          {r.kind === "engine" && <span className="text-ink-3">{r.title}</span>}
          {m.kind === "PROPOSAL" && <span className="label-caps">proposal</span>}
          {m.kind === "VERDICT" && <span className="label-caps">verdict</span>}
          {m.kind === "REPORT" && <span className="label-caps">report</span>}
          <time className="num text-ink-3" dateTime={m.createdAt}>{hhmm(m.createdAt)}</time>
          {m.costUsd != null && m.costUsd > 0 && <span className="num text-[10px] text-ink-3">AI ${m.costUsd.toFixed(4)}</span>}
        </p>
        <div className={`mt-1 whitespace-pre-line text-sm leading-relaxed text-ink-2 ${boxed ? `rounded-lg border px-3 py-2 ${bubbleTone(m)}` : ""}`}>{m.body}</div>
      </div>
    </li>
  );
}

const VIEW_KEY = "alphaboard:roomView";
type RoomView = "transcript" | "table";

const storedView = (): RoomView => {
  try { return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "transcript"; } catch { return "transcript"; }
};

function Room({ id, mandate }: { id: string; mandate: Mandate }) {
  const { messages, loaded, error } = useRoom(id);
  const now = useNow();
  // The panel only mounts once the view has loaded on the client, so reading storage here cannot
  // disagree with the server render.
  const [view, setView] = useState<RoomView>(() => (typeof window === "undefined" ? "transcript" : storedView()));
  const pickView = (next: RoomView) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* private mode: the choice just does not stick */ }
  };
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // A divider before the first message of each decision cycle.
  const rows: Array<{ m: SessionMessageDto; divider: boolean }> = [];
  let prev: number | null = null;
  for (const m of messages) {
    rows.push({ m, divider: m.cycle != null && m.cycle !== prev });
    if (m.cycle != null) prev = m.cycle;
  }
  return (
    <section aria-labelledby="room-heading" className="panel flex min-h-[420px] flex-col lg:h-[calc(100vh-15rem)]">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="room-heading" className="text-sm font-semibold text-ink">Desk room</h2>
        <div className="flex items-center gap-1" role="group" aria-label="Room view">
          {(["table", "transcript"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => pickView(v)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${view === v ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"}`}>{v}</button>
          ))}
        </div>
      </header>
      {view === "table" ? (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!loaded && <p className="text-sm text-ink-3">Loading the room…</p>}
          {error && <p role="alert" className="text-sm text-down">{error}</p>}
          {loaded && (
            <>
              {/* The round table needs room to breathe; below sm it collapses to the seat grid instead. */}
              <div className="hidden sm:block"><DeskRoundTable messages={messages} mandate={mandate} now={now} /></div>
              <div className="sm:hidden"><DeskTable messages={messages} mandate={mandate} now={now} /></div>
            </>
          )}
        </div>
      ) : (
      <div ref={ref} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="flex-1 overflow-y-auto px-4 py-4">
        {!loaded && <p className="text-sm text-ink-3">Loading the room…</p>}
        {error && <p role="alert" className="text-sm text-down">{error}</p>}
        {loaded && !messages.length && <p className="text-sm text-ink-3">The first cycle starts within 15 seconds.</p>}
        <ol role="log" aria-label="Session messages" className="space-y-4">
          {rows.map(({ m, divider }) => (
            <Fragment key={m.id}>
              {divider && (
                <li aria-hidden className="flex items-center gap-3 pt-2 text-[11px] text-ink-3">
                  <span className="h-px flex-1 bg-line" /><span className="label-caps">Cycle {m.cycle} · {hhmm(m.createdAt)}</span><span className="h-px flex-1 bg-line" />
                </li>
              )}
              <Message m={m} />
            </Fragment>
          ))}
        </ol>
      </div>
      )}
    </section>
  );
}

// ─── Positions ───────────────────────────────────────────────────────────────

const pnlTone = (n: number | null) => (n == null || n === 0 ? "text-ink-2" : n > 0 ? "text-up" : "text-down");

function PositionCard({ p, onAction, busy }: { p: SessionPositionDto; onAction: (id: string, a: "close" | "close_half" | "breakeven") => void; busy: boolean }) {
  const btn = "rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-2 hover:border-line-2 hover:text-ink disabled:opacity-50";
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${p.side === "LONG" ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>{p.side}{p.leverage > 1 ? ` ${p.leverage}×` : ""}</span>
          {p.symbol}
        </p>
        <p className={`num text-sm font-semibold ${pnlTone(p.unrealizedPnl)}`}>{usd(p.unrealizedPnl, true)}</p>
      </div>
      <dl className="num mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div><dt className="text-ink-3">Size</dt><dd className="text-ink">{fmtQty(p.qty)}</dd></div>
        <div><dt className="text-ink-3">Entry</dt><dd className="text-ink">{fmtPrice(p.entryPrice)}</dd></div>
        <div><dt className="text-ink-3">Mark</dt><dd className="text-ink">{p.markPrice == null ? "Unavailable" : fmtPrice(p.markPrice)}</dd></div>
        <div><dt className="text-ink-3">Stop</dt><dd className="text-down">{fmtPrice(p.stopLoss)}</dd></div>
        <div><dt className="text-ink-3">Target</dt><dd className="text-up">{fmtPrice(p.takeProfit)}</dd></div>
        <div><dt className="text-ink-3">Horizon</dt><dd className="text-ink">{p.horizonMin ? durationText(p.horizonMin) : "—"}</dd></div>
      </dl>
      {p.invalidation && <p className="mt-2 text-[11px] text-ink-3"><span className="font-semibold text-ink-2">Invalidation:</span> {p.invalidation}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" disabled={busy} className={btn} onClick={() => window.confirm(`Close ${p.side} ${p.symbol} at market?`) && onAction(p.id, "close")}>Close</button>
        <button type="button" disabled={busy} className={btn} onClick={() => window.confirm(`Close half of ${p.symbol} at market?`) && onAction(p.id, "close_half")}>Close 50%</button>
        <button type="button" disabled={busy} className={btn} onClick={() => onAction(p.id, "breakeven")}>Stop → breakeven</button>
      </div>
    </li>
  );
}

// ─── Report ──────────────────────────────────────────────────────────────────

function ReportPanel({ id }: { id: string }) {
  const { data: r, error } = useSessionReport(id);
  if (error) return <p role="alert" className="panel p-4 text-sm text-down">{error}</p>;
  if (!r) return <div className="panel h-40 animate-pulse" />;
  const m = r.metrics;
  const stat = (label: string, value: string, tone = "text-ink") => (
    <div><dt className="label-caps">{label}</dt><dd className={`num mt-1 text-lg font-semibold ${tone}`}>{value}</dd></div>
  );
  return (
    <section aria-labelledby="report-heading" className="panel p-5">
      <h2 id="report-heading" className="font-display text-lg font-bold text-ink">Session report</h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stat("Net P&L", `${usd(m.netPnl, true)} (${m.returnPct.toFixed(2)}%)`, pnlTone(m.netPnl))}
        {m.netAfterLlm == null
          ? stat(`After AI cost`, `— (${m.accountCurrency ?? "account"} vs USD)`)
          : stat("After AI cost", usd(m.netAfterLlm, true), pnlTone(m.netAfterLlm))}
        {stat("Trades · win rate", `${m.trades} · ${m.winRate == null ? "—" : `${Math.round(m.winRate * 100)}%`}`)}
        {stat("Buy and hold", m.buyAndHold ? `${m.buyAndHold.returnPct >= 0 ? "+" : "−"}${Math.abs(m.buyAndHold.returnPct).toFixed(2)}% ${m.buyAndHold.symbol}` : "Unavailable")}
        {stat("Fees", usd(m.fees))}
        {stat("AI cost (USD)", usd(m.llmCostUsd))}
        {stat("Expectancy", m.expectancyR == null ? "—" : `${m.expectancyR.toFixed(2)}R`)}
        {stat("Max drawdown", usd(m.maxDrawdown))}
      </dl>
      <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-ink-2">{r.summary}</p>
      {r.lessons.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold text-ink">Lessons for next time</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">{r.lessons.map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      )}
      {m.rejections.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-semibold text-ink">What the risk engine refused</h3>
          <ul className="mt-2 space-y-1 text-sm text-ink-2">{m.rejections.map((x) => <li key={x.reason}><span className="num text-ink-3">×{x.count}</span> {x.reason}</li>)}</ul>
        </>
      )}
      <p className="mt-4 text-xs text-ink-3">Closed trades are in your <Link href="/journal" className="text-accent hover:underline">Journal</Link> with the agent&apos;s lesson.</p>
    </section>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

function Controls({ v, control, busy }: { v: SessionViewDto; control: (b: Parameters<ReturnType<typeof useSessionView>["control"]>[0]) => void; busy: boolean }) {
  const active = ["RUNNING", "PAUSED", "AWAITING_EXTENSION", "ENDING"].includes(v.status);
  const btn = "rounded-lg border border-line bg-paper px-3 py-1.5 text-sm font-medium text-ink-2 hover:border-line-2 hover:text-ink disabled:opacity-50";
  if (!active) {
    return v.positions.length ? (
      <button type="button" disabled={busy} className="rounded-lg bg-down px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-50"
        onClick={() => window.confirm("Close every remaining position now?") && control({ action: "kill" })}>Close remaining positions</button>
    ) : null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {v.status === "RUNNING" && <button type="button" disabled={busy} className={btn} onClick={() => control({ action: "pause" })}>Pause</button>}
      {v.status === "PAUSED" && <button type="button" disabled={busy} className={btn} onClick={() => control({ action: "resume" })}>Resume</button>}
      <button type="button" disabled={busy} className={btn} onClick={() => control({ action: "extend", minutes: 60 })}>Extend 1h</button>
      <button type="button" disabled={busy} className={btn} onClick={() => window.confirm("End the session now and close all positions?") && control({ action: "end", mode: "CLOSE_ALL" })}>End</button>
      <button type="button" disabled={busy} className="rounded-lg bg-down px-3 py-1.5 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        onClick={() => window.confirm("Kill switch: close every position and stop trading immediately?") && control({ action: "kill" })}>Kill</button>
    </div>
  );
}

export default function SessionRoom({ id }: { id: string }) {
  const { view: v, loaded, error, control, positionAction } = useSessionView(id);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try { await fn(); } catch (e) { setActionError(e instanceof Error ? e.message : "That did not work"); } finally { setBusy(false); }
  };

  if (!loaded) return <Shell><div className="panel h-64 animate-pulse" /></Shell>;
  if (!v) return <Shell><p role="alert" className="panel p-6 text-sm text-down">{error ?? "Session not found"}</p></Shell>;

  const left = now ? Math.max(0, new Date(v.endsAt).getTime() - now) : v.meters.timeLeftMs;
  const deadline = v.extension ? Math.max(0, new Date(v.extension.deadline).getTime() - (now || Date.parse(v.extension.promptedAt))) : 0;
  const net = v.equity == null ? null : v.equity - v.capital;

  return (
    <Shell>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/sessions" className="text-xs text-ink-3 hover:text-ink">← Sessions</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-2xl font-bold text-ink">{v.name}</h1>
            <StatusPill status={v.status} />
          </div>
          <p className="mt-1 text-xs text-ink-3">
            {v.venue === "exchange" ? (v.live ? <span className="font-bold text-down">LIVE · real money</span> : "Exchange testnet") : "Paper"} · {v.marketType === "swap" ? `perpetual up to ${v.mandate.maxLeverage}×` : "spot"} · {v.symbols.join(", ")} · decides every {durationText(v.mandate.decisionIntervalMin)}
            {v.endReason ? ` · ${END_REASON[v.endReason] ?? v.endReason}` : ""}
          </p>
        </div>
        <Controls v={v} busy={busy} control={(b) => void run(() => control(b))} />
      </header>

      {(actionError || error) && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg bg-down-soft px-3 py-2 text-sm text-down">
          <span>{actionError ?? error}</span>
          {actionError && <button type="button" onClick={() => setActionError(null)} className="shrink-0 text-xs font-semibold underline">Dismiss</button>}
        </div>
      )}

      {v.status === "AWAITING_EXTENSION" && (
        <section role="alertdialog" aria-labelledby="ext-title" className="rounded-2xl border border-accent/30 bg-accent-soft p-4">
          <h2 id="ext-title" className="font-semibold text-ink">Time is up — extend the session?</h2>
          <p className="mt-1 text-sm text-ink-2">
            Without an answer in <span className="num font-semibold">{timeLeft(deadline)}</span> the session ends and {v.mandate.onEnd === "CLOSE_ALL" ? "all positions are closed" : "positions keep their stops"}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper" onClick={() => void run(() => control({ action: "extend", minutes: 60 }))}>Extend 1h</button>
            <button type="button" disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper" onClick={() => void run(() => control({ action: "extend", minutes: 120 }))}>Extend 2h</button>
            <button type="button" disabled={busy} className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm" onClick={() => void run(() => control({ action: "end", mode: "CLOSE_ALL" }))}>Close all</button>
            <button type="button" disabled={busy} className="rounded-lg border border-line bg-paper px-3 py-1.5 text-sm" onClick={() => void run(() => control({ action: "end", mode: "KEEP_WITH_STOPS" }))}>Keep with stops</button>
          </div>
        </section>
      )}

      <section aria-label="Session meters" className="panel grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Meter label="Time left" value={left} max={Math.max(1, new Date(v.endsAt).getTime() - new Date(v.startedAt).getTime())} text={v.status === "ENDED" || v.status === "HALTED" ? "Ended" : timeLeft(left)} />
        <Meter label="Loss used" value={v.meters.lossUsed} max={v.meters.lossLimit} text={`${usd(v.meters.lossUsed)} of ${usd(v.meters.lossLimit)}`} danger />
        <Meter label="Trades" value={v.meters.trades} max={v.meters.maxTrades} text={`${v.meters.trades} of ${v.meters.maxTrades} · ${v.meters.openPositions} open`} />
        <Meter label="AI cost" value={v.meters.llmCostUsd} max={v.meters.maxLlmCostUsd} text={`${usd(v.meters.llmCostUsd)} of ${usd(v.meters.maxLlmCostUsd)}${v.llmBudgetHit ? " · used" : ""}`} danger />
        <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3 sm:col-span-2 lg:col-span-4">
          <div><dt className="label-caps">Net P&amp;L</dt><dd className={`num mt-0.5 text-lg font-semibold ${pnlTone(net)}`}>{usd(net, true)}</dd></div>
          <div><dt className="label-caps">Realized</dt><dd className={`num mt-0.5 text-lg font-semibold ${pnlTone(v.netPnl)}`}>{usd(v.netPnl, true)}</dd></div>
          <div><dt className="label-caps">Equity</dt><dd className="num mt-0.5 text-lg font-semibold text-ink">{usd(v.equity)}</dd></div>
        </dl>
      </section>

      {v.hasReport && <ReportPanel id={id} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Room id={id} mandate={v.mandate} />
        <aside className="order-first space-y-4 lg:order-none" aria-label="Positions">
          <section className="panel p-4" aria-labelledby="open-heading">
            <h2 id="open-heading" className="text-sm font-semibold text-ink">Open positions</h2>
            {v.positions.length ? (
              <ul className="mt-3 space-y-3">{v.positions.map((p) => <PositionCard key={p.id} p={p} busy={busy} onAction={(pid, a) => void run(() => positionAction(pid, a))} />)}</ul>
            ) : <p className="mt-2 text-sm text-ink-3">None open.</p>}
          </section>
          {v.closedPositions.length > 0 && (
            <section className="panel p-4" aria-labelledby="closed-heading">
              <h2 id="closed-heading" className="text-sm font-semibold text-ink">Closed trades</h2>
              <ul className="mt-2 divide-y divide-line">
                {v.closedPositions.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                    <span className="text-ink-2"><span className="font-semibold text-ink">{p.side} {p.symbol}</span> · {p.closeReason?.toLowerCase().replace("_", " ")}</span>
                    <span className={`num font-semibold ${pnlTone(p.realizedPnl)}`}>{usd(p.realizedPnl, true)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="panel p-4 text-xs text-ink-2" aria-labelledby="mandate-heading">
            <h2 id="mandate-heading" className="text-sm font-semibold text-ink">Mandate</h2>
            <dl className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              <dt className="text-ink-3">Capital</dt><dd>{usd(v.mandate.capital)}</dd>
              <dt className="text-ink-3">Risk per trade</dt><dd>{v.mandate.riskPerTradePct}%</dd>
              <dt className="text-ink-3">Max position</dt><dd>{v.mandate.maxPositionPct}% of capital</dd>
              <dt className="text-ink-3">Loss limit</dt><dd>{usd(v.mandate.lossLimit)}</dd>
              <dt className="text-ink-3">Open / trades</dt><dd>{v.mandate.maxOpenPositions} / {v.mandate.maxTrades}</dd>
              <dt className="text-ink-3">Cooldown</dt><dd>{v.mandate.cooldownMin} min</dd>
              <dt className="text-ink-3">At the end</dt><dd>{v.mandate.onEnd === "CLOSE_ALL" ? "Close all" : "Keep with stops"}</dd>
              <dt className="text-ink-3">Debate</dt><dd>{v.mandate.debate ? "On" : "Off"}</dd>
            </dl>
          </section>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-page">
      <NavBar />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">{children}</div>
      </main>
    </div>
  );
}
