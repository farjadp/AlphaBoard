"use client";

import { useMemo, useState } from "react";
import { ASSET_CATALOG, CATEGORY_LABELS, findAsset, type AssetCategory } from "@/lib/assetCatalog";
import { FEE_RATE, MAX_LEVERAGE, SLIPPAGE, liquidationPrice } from "@/lib/paper/engine";
import type { PaperSide } from "@/lib/types/paper";
import type { OrderTicket as Ticket } from "@/hooks/usePaper";
import { money, price as fmtPrice, qty as fmtQty } from "./format";

export interface TicketPrefill {
  signalId: string;
  label: string;
  symbol: string;
  side: PaperSide | null;
  stopLoss: number | null;
  takeProfit: number | null;
  leverage: number;
}

const field = "w-full rounded-lg border border-line bg-wash px-3 py-2 text-sm tabular-nums text-ink outline-none focus-visible:border-accent";
const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-3";
const num = (s: string) => { const n = Number.parseFloat(s); return Number.isFinite(n) ? n : null; };

export default function OrderTicket({ cash, livePrice, prefill, onSymbol, onSubmit }: {
  cash: number;
  livePrice: (symbol: string) => number | null;
  prefill: TicketPrefill | null;
  onSymbol: (symbol: string) => void;
  onSubmit: (t: Ticket) => Promise<unknown>;
}) {
  const [symbol, setSymbol] = useState(prefill?.symbol ?? "BTC/USDT");
  const [side, setSide] = useState<PaperSide>(prefill?.side ?? "LONG");
  const [margin, setMargin] = useState(String(Math.min(1_000, Math.floor(cash))));
  const [leverage, setLeverage] = useState(String(prefill?.leverage ?? 1));
  const [stopLoss, setStopLoss] = useState(prefill?.stopLoss != null ? String(prefill.stopLoss) : "");
  const [takeProfit, setTakeProfit] = useState(prefill?.takeProfit != null ? String(prefill.takeProfit) : "");
  const [signalId, setSignalId] = useState(prefill?.signalId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const m = new Map<AssetCategory, typeof ASSET_CATALOG>();
    for (const a of ASSET_CATALOG) m.set(a.category, [...(m.get(a.category) ?? []), a]);
    return [...m.entries()];
  }, []);

  const ref = livePrice(symbol);
  const m = num(margin), lev = num(leverage), sl = num(stopLoss), tp = num(takeProfit);
  const fill = ref == null ? null : ref * (side === "LONG" ? 1 + SLIPPAGE : 1 - SLIPPAGE);
  const notional = m != null && lev != null ? m * lev : null;
  const fee = notional == null ? null : notional * FEE_RATE;
  const problem =
    m == null || m <= 0 ? "Enter a margin amount"
    : lev == null || lev < 1 || lev > MAX_LEVERAGE ? `Leverage must be 1–${MAX_LEVERAGE}`
    : fee != null && m + fee > cash ? "Not enough cash for margin + fee"
    : fill != null && sl != null && (side === "LONG" ? sl >= fill : sl <= fill) ? `Stop-loss must be ${side === "LONG" ? "below" : "above"} the price`
    : fill != null && tp != null && (side === "LONG" ? tp <= fill : tp >= fill) ? `Take-profit must be ${side === "LONG" ? "above" : "below"} the price`
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem || m == null || lev == null) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ symbol, side, margin: m, leverage: lev, stopLoss: sl ?? undefined, takeProfit: tp ?? undefined, signalId: signalId ?? undefined });
      setSignalId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel space-y-4 p-5" aria-label="Paper order ticket">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Market order</h2>
        <span className="text-xs tabular-nums text-ink-3">Cash {money(cash)} USDT</span>
      </div>

      {signalId && prefill && (
        <p className="rounded-lg border border-line bg-accent-soft px-3 py-2 text-xs text-ink-2">
          From signal: <span className="font-medium text-ink">{prefill.label}</span>
          {!prefill.side && " — the signal was HOLD, pick a side yourself."}
        </p>
      )}

      <div>
        <label htmlFor="pt-symbol" className={label}>Asset</label>
        <select id="pt-symbol" className={field} value={symbol} onChange={(e) => { setSymbol(e.target.value); onSymbol(e.target.value); }}>
          {groups.map(([cat, assets]) => (
            <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
              {assets.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol} — {a.name}</option>)}
            </optgroup>
          ))}
        </select>
        <p className="mt-1 text-xs tabular-nums text-ink-3">
          Last price: <span className="text-ink-2">{ref == null ? "Unavailable" : fmtPrice(ref)}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Side">
        {(["LONG", "SHORT"] as const).map((s) => (
          <button
            key={s} type="button" role="radio" aria-checked={side === s} onClick={() => setSide(s)}
            className={`rounded-lg border py-2 text-sm font-semibold transition-colors ${side === s
              ? s === "LONG" ? "border-up bg-up-soft text-up" : "border-down bg-down-soft text-down"
              : "border-line text-ink-3 hover:text-ink-2"}`}
          >
            {s === "LONG" ? "Long / Buy" : "Short / Sell"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="pt-margin" className={label}>Margin (USDT)</label>
          <input id="pt-margin" className={field} inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pt-lev" className={label}>Leverage (×)</label>
          <input id="pt-lev" className={field} type="number" min={1} max={MAX_LEVERAGE} step={1} value={leverage} onChange={(e) => setLeverage(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pt-sl" className={label}>Stop-loss</label>
          <input id="pt-sl" className={field} inputMode="decimal" placeholder="Optional" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pt-tp" className={label}>Take-profit</label>
          <input id="pt-tp" className={field} inputMode="decimal" placeholder="Optional" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-wash p-3 text-xs tabular-nums">
        <dt className="text-ink-3">Est. fill</dt><dd className="text-right text-ink-2">{fill == null ? "Unavailable" : fmtPrice(fill)}</dd>
        <dt className="text-ink-3">Position size</dt><dd className="text-right text-ink-2">{notional == null ? "—" : `${money(notional)} USDT`}</dd>
        <dt className="text-ink-3">Quantity</dt><dd className="text-right text-ink-2">{notional == null || fill == null ? "—" : `${fmtQty(notional / fill)} ${findAsset(symbol)?.symbol.split("/")[0] ?? ""}`}</dd>
        <dt className="text-ink-3">Fee (0.05%)</dt><dd className="text-right text-ink-2">{fee == null ? "—" : money(fee)}</dd>
        <dt className="text-ink-3">Liquidation</dt><dd className="text-right text-ink-2">{fill == null || lev == null || lev < 1 ? "—" : lev === 1 && side === "LONG" ? "None" : fmtPrice(liquidationPrice(side, fill, lev))}</dd>
      </dl>

      {(error || problem) && <p role="alert" className={`text-xs ${error ? "text-down" : "text-ink-3"}`}>{error ?? problem}</p>}

      <button
        type="submit" disabled={busy || !!problem || ref == null}
        className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${side === "LONG" ? "bg-up text-paper" : "bg-down text-paper"}`}
      >
        {busy ? "Placing…" : `${side === "LONG" ? "Buy / Long" : "Sell / Short"} ${symbol}`}
      </button>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Simulated. Fills at the live price with 0.05% slippage and a 0.05% fee per side. Stops and targets are checked every minute against candle highs and lows.
      </p>
    </form>
  );
}
