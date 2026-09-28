"use client";

import { useCallback, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import { usePaper } from "@/hooks/usePaper";
import { useBinanceTickers } from "@/hooks/useBinanceTickers";
import { useTradfiQuotes } from "@/hooks/useTradfiQuotes";
import { findAsset } from "@/lib/assetCatalog";
import OrderTicket, { type TicketPrefill } from "./OrderTicket";
import LineChart from "@/components/charts/LineChart";
import { ClosedPositions, OpenPositions } from "./PositionsTable";
import { money, pct, tone } from "./format";

function Stat({ label, value, sub, className = "text-[var(--text)]" }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-3)]">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${className}`}>{value}</p>
      {sub && <p className="text-xs tabular-nums text-[var(--text-3)]">{sub}</p>}
    </div>
  );
}

function ResetPanel({ current, onReset }: { current: number; onReset: (balance: number) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState(String(current));
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-xs text-[var(--text-3)] underline decoration-dotted hover:text-[var(--text-2)]">Reset account…</button>;
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-xs"
      onSubmit={async (e) => {
        e.preventDefault();
        const b = Number.parseFloat(balance);
        if (!(b >= 100 && b <= 10_000_000)) { setError("Balance must be 100 – 10,000,000"); return; }
        if (!window.confirm("Reset the paper account? All positions, orders and the equity curve are deleted.")) return;
        try { await onReset(b); setOpen(false); setError(null); } catch (err) { setError(err instanceof Error ? err.message : "Reset failed"); }
      }}
    >
      <label htmlFor="reset-balance" className="text-[var(--text-3)]">Start again with</label>
      <input id="reset-balance" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} className="w-28 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 tabular-nums text-[var(--text)]" />
      <span className="text-[var(--text-3)]">USDT</span>
      <button type="submit" className="rounded border border-[var(--red)] px-2 py-1 font-medium text-[var(--red)] hover:bg-[var(--red-bg)]">Reset</button>
      <button type="button" onClick={() => setOpen(false)} className="px-1 text-[var(--text-3)]">Cancel</button>
      {error && <span role="alert" className="w-full text-[var(--red)]">{error}</span>}
    </form>
  );
}

export default function PaperScreen({ prefill }: { prefill: TicketPrefill | null }) {
  const { overview, loaded, error, placeOrder, closePosition, updateExits, resetAccount } = usePaper();
  const [ticketSymbol, setTicketSymbol] = useState(prefill?.symbol ?? "BTC/USDT");
  const [tab, setTab] = useState<"open" | "closed">("open");

  const binance = useMemo(() => { const b = findAsset(ticketSymbol)?.binanceSymbol; return b ? [b] : []; }, [ticketSymbol]);
  const { tickers } = useBinanceTickers(binance);
  const tradfi = useTradfiQuotes(useMemo(() => [ticketSymbol], [ticketSymbol]), 30_000);
  const livePrice = useCallback((symbol: string) => {
    const a = findAsset(symbol);
    const p = a?.binanceSymbol ? tickers[a.binanceSymbol]?.price : tradfi[symbol]?.price;
    return p && p > 0 ? p : null;
  }, [tickers, tradfi]);

  const a = overview?.account;
  const winRate = a && a.closedCount > 0 ? (a.winCount / a.closedCount) * 100 : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg)]">
      <NavBar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[var(--text)]">Paper trading</h1>
              <p className="mt-1 text-sm text-[var(--text-3)]">Practice with simulated USDT at live prices. No real orders are ever sent.</p>
            </div>
            {a && <ResetPanel current={a.startingBalance} onReset={resetAccount} />}
          </header>

          {error && <p role="alert" className="rounded-lg border border-[var(--red)] bg-[var(--red-bg)] px-3 py-2 text-sm text-[var(--red)]">{error}</p>}
          {!loaded && <p className="text-sm text-[var(--text-3)]">Loading account…</p>}

          {a && overview && (
            <>
              <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Account summary">
                <Stat label="Equity" value={a.equity == null ? "Unavailable" : `${money(a.equity)}`} sub={a.equity == null ? "A live price is missing" : `USDT · started at ${money(a.startingBalance)}`} />
                <Stat label="Return" value={pct(a.returnPct)} className={tone(a.returnPct)} sub={`Realized ${money(a.realizedPnl, true)}`} />
                <Stat label="Unrealized PnL" value={money(a.unrealizedPnl, true)} className={tone(a.unrealizedPnl)} sub={`${overview.positions.length} open · margin ${money(a.usedMargin)}`} />
                <Stat label="Win rate" value={winRate == null ? "—" : `${winRate.toFixed(0)}%`} sub={`${a.winCount} of ${a.closedCount} closed trades`} />
              </section>

              <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                <div className="min-w-0 space-y-6">
                  <section className="glass-card p-5" aria-labelledby="eq-title">
                    <h2 id="eq-title" className="mb-3 text-sm font-semibold text-[var(--text)]">Equity</h2>
                    <LineChart
                      points={overview.equityCurve.map((p) => ({ at: p.at, value: p.equity }))} baseline={a.startingBalance}
                      baselineLabel={`Start ${money(a.startingBalance)}`} unit="usdt" title="Equity"
                      empty="The curve starts once the account has a few equity points (every trade, and every 15 minutes while positions are open)."
                    />
                  </section>

                  <section className="glass-card overflow-hidden" aria-label="Positions">
                    <div className="flex gap-1 border-b border-[var(--border)] p-2" role="tablist">
                      {([["open", `Open (${overview.positions.length})`], ["closed", `History (${a.closedCount})`]] as const).map(([k, l]) => (
                        <button
                          key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === k ? "bg-[var(--surface-active)] text-[var(--text)]" : "text-[var(--text-3)] hover:text-[var(--text-2)]"}`}
                        >{l}</button>
                      ))}
                    </div>
                    {tab === "open"
                      ? <OpenPositions positions={overview.positions} onClose={closePosition} onExits={(id, stopLoss, takeProfit) => updateExits(id, { stopLoss, takeProfit })} />
                      : <ClosedPositions positions={overview.history} />}
                  </section>
                </div>

                <aside>
                  <OrderTicket
                    cash={a.cash} livePrice={livePrice} prefill={prefill} onSymbol={setTicketSymbol}
                    onSubmit={async (t) => { await placeOrder(t); setTab("open"); }}
                  />
                </aside>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
