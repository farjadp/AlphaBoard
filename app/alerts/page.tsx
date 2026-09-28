"use client";

import { useCallback, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import { useAlerts } from "@/hooks/useAlerts";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useBinanceTickers } from "@/hooks/useBinanceTickers";
import { useTradfiQuotes } from "@/hooks/useTradfiQuotes";
import { formatPrice } from "@/lib/binance";
import { findAsset } from "@/lib/assetCatalog";

export default function AlertsPage() {
  const { alerts, addAlert, removeAlert } = useAlerts();
  const { watchlist, symbols } = useWatchlist();

  // State for new alert form
  const [selectedSymbol, setSelectedSymbol] = useState<string>(symbols[0] || "BTC/USDT");
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [condition, setCondition] = useState<"above" | "below">("above");

  // Stream prices for the watchlist AND every symbol with an active alert (v1 only watched the
  // watchlist, so an alert on any other asset could never fire).
  const alertSymbols = useMemo(
    () => Array.from(new Set([...symbols, ...alerts.filter((a) => !a.triggered).map((a) => a.symbol), selectedSymbol])),
    [symbols, alerts, selectedSymbol],
  );
  const cryptoSymbols = useMemo(
    () => alertSymbols.map((s) => findAsset(s)?.binanceSymbol).filter((s): s is string => !!s),
    [alertSymbols],
  );
  const { tickers } = useBinanceTickers(cryptoSymbols);
  const tradfiQuotes = useTradfiQuotes(alertSymbols.filter((s) => findAsset(s)?.yahooSymbol), 60_000);

  const getCurrentPrice = useCallback((sym: string) => {
    const asset = findAsset(sym);
    if (!asset) return 0;
    if (asset.binanceSymbol) return tickers[asset.binanceSymbol]?.price || 0;
    return tradfiQuotes[sym]?.price || 0;
  }, [tickers, tradfiQuotes]);

  const handleAddAlert = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) return;
    addAlert(selectedSymbol, price, condition);
    setTargetPrice("");
  };

  const activeAlerts = alerts.filter(a => !a.triggered);
  const triggeredAlerts = alerts.filter(a => a.triggered);

  return (
    <div className="min-h-full bg-page">
      <NavBar />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">

          {/* Left Col: Create Alert Form */}
          <div className="space-y-6 animate-fade-up md:col-span-1">
            <div>
              <h1 className="font-display text-2xl font-extrabold text-ink">Price Alerts</h1>
              <p className="mt-1 text-sm text-ink-3">Checked on the server every minute against candle highs and lows, even when this page is closed. You are notified in the bell (and on Telegram if linked in Settings).</p>
            </div>

            <form onSubmit={handleAddAlert} className="panel space-y-5 p-5">
              <div>
                <label htmlFor="alert-asset" className="label-caps mb-2 block">Asset</label>
                <select
                  id="alert-asset"
                  className="w-full rounded-lg border border-line bg-paper p-2.5 text-sm text-ink focus:border-accent focus:outline-none"
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                >
                  {watchlist.map(asset => (
                    <option key={asset.symbol} value={asset.symbol}>{asset.symbol} ({asset.name})</option>
                  ))}
                  {watchlist.length === 0 && <option disabled>No assets in watchlist</option>}
                </select>
              </div>

              <div>
                <label className="label-caps mb-2 block">Alert me when price drops/rises</label>
                <div className="flex rounded-lg bg-wash p-1">
                  <button
                    type="button"
                    className={`flex-1 rounded-md py-1.5 text-xs font-bold transition-colors ${condition === "above" ? "bg-up-soft text-up" : "text-ink-3 hover:text-ink"}`}
                    onClick={() => setCondition("above")}
                  >
                    Goes Above
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-md py-1.5 text-xs font-bold transition-colors ${condition === "below" ? "bg-down-soft text-down" : "text-ink-3 hover:text-ink"}`}
                    onClick={() => setCondition("below")}
                  >
                    Drops Below
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="alert-target" className="label-caps mb-2 block">Target Price (USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">$</span>
                  <input
                    id="alert-target"
                    type="number"
                    step="any"
                    required
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    placeholder={getCurrentPrice(selectedSymbol) > 0 ? getCurrentPrice(selectedSymbol).toString() : "Target price"}
                    className="num w-full rounded-lg border border-line bg-paper py-2.5 pl-7 pr-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-ink-3">Current: <span className="num">{getCurrentPrice(selectedSymbol) > 0 ? formatPrice(getCurrentPrice(selectedSymbol)) : "Unavailable"}</span></p>
              </div>

              <button
                type="submit"
                disabled={watchlist.length === 0}
                className="w-full cursor-pointer rounded-lg bg-ink py-3 text-xs font-bold uppercase tracking-wider text-paper hover:bg-[#23313f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create Alert
              </button>
            </form>
          </div>

          {/* Right Col: Alerts List */}
          <div className="space-y-6 animate-fade-up [animation-delay:100ms] md:col-span-2">

            {/* Active Alerts */}
            <div>
              <h3 className="label-caps mb-4 text-ink">Active Alerts ({activeAlerts.length})</h3>

              {activeAlerts.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-line-2 bg-paper p-8 text-center">
                  <p className="text-sm text-ink-3">No active alerts. Add one to start tracking.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeAlerts.map(alert => {
                    const currentPrice = getCurrentPrice(alert.symbol);
                    let diffPercent = 0;
                    if (currentPrice > 0) {
                      diffPercent = Math.abs((currentPrice - alert.targetPrice) / currentPrice) * 100;
                    }

                    return (
                      <div key={alert.id} className="panel group flex items-center justify-between p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wash text-lg font-bold text-ink-2">
                            {findAsset(alert.symbol)?.icon || alert.symbol.charAt(0)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-ink">{alert.symbol}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${alert.condition === "above" ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>{alert.condition}</span>
                            </div>
                            <div className="num mt-1 flex items-center gap-3 text-xs">
                              <span className="text-ink-2">Target: <span className="font-bold text-ink">${alert.targetPrice}</span></span>
                              <span className="text-ink-3">•</span>
                              <span className="text-ink-3">Now: {currentPrice > 0 ? formatPrice(currentPrice) : "Loading..."}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="hidden text-right sm:block">
                            <p className="label-caps">Distance</p>
                            <p className={`num text-xs font-medium ${diffPercent < 1 ? "text-amber" : "text-ink-2"}`}>
                              {diffPercent.toFixed(2)}%
                            </p>
                          </div>
                          <button
                            onClick={() => removeAlert(alert.id)}
                            className="rounded-md p-2 text-ink-3 transition-colors hover:bg-down-soft hover:text-down"
                            title="Delete Alert"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Triggered Alerts */}
            {triggeredAlerts.length > 0 && (
              <div className="mt-8">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="label-caps">Triggered History</h3>
                </div>

                <div className="space-y-3">
                  {triggeredAlerts.map(alert => (
                    <div key={alert.id} className="panel flex items-center justify-between bg-accent-soft p-4">
                      <div>
                        <p className="text-sm font-medium text-ink-2">
                          <span className="font-bold text-ink">{alert.symbol}</span> crossed {alert.condition} <span className="num font-bold text-ink">${alert.targetPrice}</span>
                        </p>
                        <p className="text-[10px] text-ink-3">
                          Triggered {new Date(alert.triggeredAt || alert.createdAt).toLocaleString()}{alert.triggerPrice != null && <> at <span className="num">{formatPrice(alert.triggerPrice)}</span></>}
                        </p>
                      </div>
                      <button onClick={() => removeAlert(alert.id)} className="rounded-md px-2 py-1 text-xs font-bold text-ink-3 hover:bg-wash hover:text-ink">Clear</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
