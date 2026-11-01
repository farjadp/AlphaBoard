"use client";

import { useState } from "react";
import Link from "next/link";
import type { PaperPositionDto } from "@/lib/paper/types";
import { rText } from "@/lib/format";
import { money, pct, price, qty, tone, when } from "./format";
import { ExitUnitToggle, convertExit, exitPrice, exitText, type ExitUnit } from "@/components/trade/ExitUnit";

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3";
const td = "px-3 py-2.5 tabular-nums";
const REASON: Record<string, string> = { MANUAL: "Closed", STOP_LOSS: "Stop-loss", TAKE_PROFIT: "Take-profit", LIQUIDATION: "Liquidated" };

const SideTag = ({ p }: { p: PaperPositionDto }) => (
  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold ${p.side === "LONG" ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>
    {p.side} {p.leverage}×
  </span>
);

function ExitsEditor({ p, onSave, onCancel }: { p: PaperPositionDto; onSave: (sl: number | null, tp: number | null) => Promise<unknown>; onCancel: () => void }) {
  const [sl, setSl] = useState(exitText(p.stopLoss));
  const [tp, setTp] = useState(exitText(p.takeProfit));
  const [unit, setUnit] = useState<ExitUnit>("price");
  const [error, setError] = useState<string | null>(null);
  // Percent is measured from the entry price.
  const slPrice = exitPrice(sl, unit, p.side, "stop", p.entryPrice, p.stopLoss), tpPrice = exitPrice(tp, unit, p.side, "target", p.entryPrice, p.takeProfit);
  const switchUnit = (to: ExitUnit) => {
    setSl(convertExit(sl, unit, to, p.side, "stop", p.entryPrice));
    setTp(convertExit(tp, unit, to, p.side, "target", p.entryPrice));
    setUnit(to);
  };
  const input = "w-28 rounded border border-line bg-paper px-2 py-1 text-xs tabular-nums text-ink";
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try { await onSave(slPrice, tpPrice); } catch (err) { setError(err instanceof Error ? err.message : "Update failed"); }
      }}
    >
      <ExitUnitToggle unit={unit} onChange={switchUnit} />
      <label className="flex items-center gap-1.5 text-[11px] text-ink-3">Stop{unit === "pct" ? " %" : ""}
        <input aria-label={unit === "pct" ? "Stop-loss, percent from entry" : "Stop-loss"} placeholder="none" className={input} value={sl} onChange={(e) => setSl(e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5 text-[11px] text-ink-3">Target{unit === "pct" ? " %" : ""}
        <input aria-label={unit === "pct" ? "Take-profit, percent from entry" : "Take-profit"} placeholder="none" className={input} value={tp} onChange={(e) => setTp(e.target.value)} />
      </label>
      <button type="submit" className="rounded bg-accent-soft px-2 py-1 text-xs text-accent">Save</button>
      <button type="button" onClick={onCancel} className="px-1 text-xs text-ink-3">Cancel</button>
      {unit === "pct" && (slPrice != null || tpPrice != null) && (
        <span className="w-full text-[11px] tabular-nums text-ink-3">From entry: SL {slPrice == null ? "—" : price(slPrice)} · TP {tpPrice == null ? "—" : price(tpPrice)}</span>
      )}
      {error && <span role="alert" className="w-full text-xs text-down">{error}</span>}
    </form>
  );
}

/** A stop the price can only reach after the position is liquidated never fires. */
function stopPastLiquidation(p: PaperPositionDto): boolean {
  if (p.stopLoss == null || !(p.liquidationPrice > 0)) return false;
  return p.side === "LONG" ? p.stopLoss <= p.liquidationPrice : p.stopLoss >= p.liquidationPrice;
}

const Figure = ({ label, children, className = "text-ink" }: { label: string; children: React.ReactNode; className?: string }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-medium uppercase tracking-wider text-ink-3">{label}</dt>
    <dd className={`mt-0.5 truncate tabular-nums ${className}`}>{children}</dd>
  </div>
);

export function OpenPositions({ positions, onClose, onExits }: {
  positions: PaperPositionDto[];
  onClose: (id: string) => Promise<unknown>;
  onExits: (id: string, sl: number | null, tp: number | null) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (positions.length === 0) return <p className="px-3 py-8 text-center text-sm text-ink-3">No open positions. Place an order, or use “Trade on paper” on a signal in the Archive.</p>;

  return (
    <div aria-label="Open positions">
      {error && <p role="alert" className="px-4 pt-3 text-xs text-down">{error}</p>}
      <ul className="divide-y divide-line">
        {positions.map((p) => {
          const upct = p.unrealizedPnl == null ? null : (p.unrealizedPnl / p.margin) * 100;
          const isEditing = editing === p.id;
          return (
            <li key={p.id} className="px-4 py-3.5 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex items-center gap-2"><span className="font-semibold text-ink">{p.symbol}</span><SideTag p={p} /></div>
                  <div className="mt-0.5 text-[11px] text-ink-3">
                    {when(p.openedAt)} · {money(p.margin * p.leverage)} USDT ({qty(p.qty)}) · margin {money(p.margin)}
                    {p.signalId && <> · <Link href="/archive" className="underline decoration-dotted">from signal</Link></>}
                  </div>
                </div>
                <div className="flex shrink-0 items-start gap-2 max-sm:w-full">
                  <div className={`mr-1 text-right tabular-nums max-sm:mr-auto max-sm:text-left ${tone(p.unrealizedPnl)}`}>
                    <div className="font-semibold">{money(p.unrealizedPnl, true)}</div>
                    <div className="text-[11px]">{pct(upct)}{p.r != null && <> · {rText(p.r)}</>}</div>
                  </div>
                  <button
                    type="button" onClick={() => setEditing(isEditing ? null : p.id)} aria-expanded={isEditing}
                    aria-label={`Edit stop and target for ${p.symbol}`}
                    className={`whitespace-nowrap rounded-md border px-3 py-1 text-xs font-medium hover:bg-wash ${isEditing ? "border-ink text-ink" : "border-line-2 text-ink-2 hover:text-ink"}`}
                  >
                    SL / TP
                  </button>
                  <button
                    type="button" disabled={closing === p.id}
                    onClick={async () => {
                      setClosing(p.id); setError(null);
                      try { await onClose(p.id); } catch (e) { setError(e instanceof Error ? e.message : "Close failed"); } finally { setClosing(null); }
                    }}
                    className="rounded-md border border-line-2 px-3 py-1 text-xs font-medium text-ink hover:bg-wash disabled:opacity-40"
                  >
                    {closing === p.id ? "Closing…" : "Close"}
                  </button>
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-5">
                <Figure label="Entry">{price(p.entryPrice)}</Figure>
                <Figure label="Mark">{p.markPrice == null ? <span className="text-ink-3">Unavailable</span> : price(p.markPrice)}</Figure>
                <Figure label="Liq.">{p.liquidationPrice > 0 ? price(p.liquidationPrice) : "—"}</Figure>
                <Figure label="Stop" className={p.stopLoss == null ? "text-ink-3" : "text-down"}>{p.stopLoss == null ? "None" : price(p.stopLoss)}</Figure>
                <Figure label="Target" className={p.takeProfit == null ? "text-ink-3" : "text-up"}>{p.takeProfit == null ? "None" : price(p.takeProfit)}</Figure>
              </dl>

              {stopPastLiquidation(p) && (
                <p className="mt-2 text-[11px] text-down">
                  Liquidation at {price(p.liquidationPrice)} comes before this stop, so the stop can never fire. Move it inside the liquidation price.
                </p>
              )}
              {p.stopLoss == null && p.leverage >= 5 && (
                <p className="mt-2 text-[11px] text-ink-3">No stop at {p.leverage}×: a {(100 / p.leverage).toFixed(1)}% move against you takes the whole margin.</p>
              )}

              {isEditing && (
                <div className="mt-3 rounded-lg bg-wash p-3">
                  <ExitsEditor p={p} onCancel={() => setEditing(null)} onSave={async (sl, tp) => { await onExits(p.id, sl, tp); setEditing(null); }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ClosedPositions({ positions }: { positions: PaperPositionDto[] }) {
  if (positions.length === 0) return <p className="px-3 py-8 text-center text-sm text-ink-3">Closed trades will appear here.</p>;
  return (
    <table className="w-full text-sm text-ink-2" aria-label="Closed positions">
      <thead><tr className="border-b border-line">
        <th className={th}>Position</th><th className={th}>Entry → exit</th><th className={`${th} hidden sm:table-cell`}>Outcome</th>
        <th className={`${th} text-right`}>Net PnL</th>
      </tr></thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.id} className="border-b border-line align-top last:border-0">
            <td className={td}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-semibold text-ink">{p.symbol}</span><SideTag p={p} /></div>
              <div className="mt-0.5 text-[11px] text-ink-3">{p.closedAt ? when(p.closedAt) : "—"}<span className="sm:hidden"> · {p.closeReason ? REASON[p.closeReason] : "—"}</span></div>
            </td>
            <td className={td}>{price(p.entryPrice)}<div className="text-[11px] text-ink-3">→ {price(p.closePrice)}</div></td>
            <td className={`${td} hidden sm:table-cell`}>{p.closeReason ? REASON[p.closeReason] : "—"}</td>
            <td className={`${td} text-right ${tone(p.realizedPnl)}`}>{money(p.realizedPnl, true)}<div className="text-[11px]">{pct(p.realizedPnl == null ? null : (p.realizedPnl / p.margin) * 100)}{p.r != null && <> · {rText(p.r)}</>}</div></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
