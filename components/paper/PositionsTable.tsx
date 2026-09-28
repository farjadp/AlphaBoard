"use client";

import { useState } from "react";
import Link from "next/link";
import type { PaperPositionDto } from "@/lib/types/paper";
import { money, pct, price, qty, tone, when } from "./format";

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3";
const td = "px-3 py-2.5 tabular-nums";
const REASON: Record<string, string> = { MANUAL: "Closed", STOP_LOSS: "Stop-loss", TAKE_PROFIT: "Take-profit", LIQUIDATION: "Liquidated" };

const SideTag = ({ p }: { p: PaperPositionDto }) => (
  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${p.side === "LONG" ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>
    {p.side} {p.leverage}×
  </span>
);

function ExitsEditor({ p, onSave, onCancel }: { p: PaperPositionDto; onSave: (sl: number | null, tp: number | null) => Promise<unknown>; onCancel: () => void }) {
  const [sl, setSl] = useState(p.stopLoss == null ? "" : String(p.stopLoss));
  const [tp, setTp] = useState(p.takeProfit == null ? "" : String(p.takeProfit));
  const [error, setError] = useState<string | null>(null);
  const parse = (s: string) => (s.trim() === "" ? null : Number.parseFloat(s));
  const input = "w-24 rounded border border-line bg-wash px-2 py-1 text-xs tabular-nums text-ink";
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try { await onSave(parse(sl), parse(tp)); } catch (err) { setError(err instanceof Error ? err.message : "Update failed"); }
      }}
    >
      <input aria-label="Stop-loss" placeholder="SL" className={input} value={sl} onChange={(e) => setSl(e.target.value)} />
      <input aria-label="Take-profit" placeholder="TP" className={input} value={tp} onChange={(e) => setTp(e.target.value)} />
      <button type="submit" className="rounded bg-accent-soft px-2 py-1 text-xs text-accent">Save</button>
      <button type="button" onClick={onCancel} className="px-1 text-xs text-ink-3">Cancel</button>
      {error && <span role="alert" className="w-full text-xs text-down">{error}</span>}
    </form>
  );
}

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
    <div className="overflow-x-auto">
      {error && <p role="alert" className="px-3 pt-2 text-xs text-down">{error}</p>}
      <table className="w-full min-w-[860px] text-sm text-ink-2">
        <thead><tr className="border-b border-line">
          <th className={th}>Position</th><th className={th}>Size</th><th className={th}>Entry</th><th className={th}>Mark</th>
          <th className={th}>Liq.</th><th className={th}>Stop / Target</th><th className={`${th} text-right`}>Unrealized</th><th className={th}><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          {positions.map((p) => {
            const upct = p.unrealizedPnl == null ? null : (p.unrealizedPnl / p.margin) * 100;
            return (
              <tr key={p.id} className="border-b border-line align-top last:border-0">
                <td className={td}>
                  <div className="flex items-center gap-2"><span className="font-semibold text-ink">{p.symbol}</span><SideTag p={p} /></div>
                  <div className="mt-0.5 text-[11px] text-ink-3">{when(p.openedAt)}{p.signalId && <> · <Link href="/archive" className="underline decoration-dotted">from signal</Link></>}</div>
                </td>
                <td className={td}>{money(p.margin * p.leverage)}<div className="text-[11px] text-ink-3">{qty(p.qty)} · margin {money(p.margin)}</div></td>
                <td className={td}>{price(p.entryPrice)}</td>
                <td className={td}>{p.markPrice == null ? <span className="text-ink-3">Unavailable</span> : price(p.markPrice)}</td>
                <td className={td}>{p.liquidationPrice > 0 ? price(p.liquidationPrice) : "—"}</td>
                <td className={td}>
                  {editing === p.id
                    ? <ExitsEditor p={p} onCancel={() => setEditing(null)} onSave={async (sl, tp) => { await onExits(p.id, sl, tp); setEditing(null); }} />
                    : <button type="button" onClick={() => setEditing(p.id)} className="text-left hover:text-ink" aria-label={`Edit stop and target for ${p.symbol}`}>
                        <span className="text-down">{p.stopLoss == null ? "—" : price(p.stopLoss)}</span>
                        <span className="px-1 text-ink-3">/</span>
                        <span className="text-up">{p.takeProfit == null ? "—" : price(p.takeProfit)}</span>
                        <span className="ml-2 text-[11px] text-ink-3">edit</span>
                      </button>}
                </td>
                <td className={`${td} text-right ${tone(p.unrealizedPnl)}`}>{money(p.unrealizedPnl, true)}<div className="text-[11px]">{pct(upct)}</div></td>
                <td className={`${td} text-right`}>
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ClosedPositions({ positions }: { positions: PaperPositionDto[] }) {
  if (positions.length === 0) return <p className="px-3 py-8 text-center text-sm text-ink-3">Closed trades will appear here.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm text-ink-2">
        <thead><tr className="border-b border-line">
          <th className={th}>Position</th><th className={th}>Entry</th><th className={th}>Exit</th><th className={th}>Outcome</th>
          <th className={th}>Closed</th><th className={`${th} text-right`}>Net PnL</th>
        </tr></thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id} className="border-b border-line last:border-0">
              <td className={td}><div className="flex items-center gap-2"><span className="font-semibold text-ink">{p.symbol}</span><SideTag p={p} /></div></td>
              <td className={td}>{price(p.entryPrice)}</td>
              <td className={td}>{price(p.closePrice)}</td>
              <td className={td}>{p.closeReason ? REASON[p.closeReason] : "—"}</td>
              <td className={td}>{p.closedAt ? when(p.closedAt) : "—"}</td>
              <td className={`${td} text-right ${tone(p.realizedPnl)}`}>{money(p.realizedPnl, true)}<div className="text-[11px]">{pct(p.realizedPnl == null ? null : (p.realizedPnl / p.margin) * 100)}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
