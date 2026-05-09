"use client";

import { useState, useEffect } from "react";
import NavBar from "@/components/NavBar";
import { useAlerts, PriceAlert } from "@/hooks/useAlerts";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useBinanceTickers } from "@/hooks/useBinanceTickers";
import { useTradfiQuotes } from "@/hooks/useTradfiQuotes";
import { formatPrice } from "@/lib/binance";
import { findAsset } from "@/lib/assetCatalog";

export default function AlertsPage() {
  const { alerts, addAlert, removeAlert, markTriggered } = useAlerts();
  const { watchlist, symbols } = useWatchlist();

  // State for new alert form
  const [selectedSymbol, setSelectedSymbol] = useState<string>(symbols[0] || "BTC/USDT");
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [condition, setCondition] = useState<"above" | "below">("above");

  // Get live data to check triggers
  const cryptoSymbols = watchlist.filter(a => a.binanceSymbol).map(a => a.binanceSymbol!);
  const { tickers } = useBinanceTickers(cryptoSymbols);
  const tradfiSymbols = symbols.filter(s => findAsset(s)?.yahooSymbol);
  const tradfiQuotes = useTradfiQuotes(tradfiSymbols, 60000);

  // Helper to get current price
  const getCurrentPrice = (sym: string) => {
    const asset = findAsset(sym);
    if (!asset) return 0;
    if (asset.category === "crypto" && asset.binanceSymbol) {
      return tickers[asset.binanceSymbol]?.price || 0;
    }
    return tradfiQuotes[sym]?.price || 0;
  };

  // Check triggers continuously
  useEffect(() => {
    alerts.forEach((alert) => {
      if (alert.triggered) return;
      const currentPrice = getCurrentPrice(alert.symbol);
      if (!currentPrice) return;

      if (alert.condition === "above" && currentPrice >= alert.targetPrice) {
        markTriggered(alert.id);
      } else if (alert.condition === "below" && currentPrice <= alert.targetPrice) {
        markTriggered(alert.id);
      }
    });
  }, [alerts, tickers, tradfiQuotes]);

  // Set default price when symbol changes
  useEffect(() => {
    const currentPrice = getCurrentPrice(selectedSymbol);
    if (currentPrice && !targetPrice) {
      setTargetPrice(currentPrice.toString());
    }
  }, [selectedSymbol]);

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
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <NavBar />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Left Col: Create Alert Form */}
          <div className="md:col-span-1 space-y-6 animate-fade-up">
            <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Price Alerts</h1>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Set triggers to catch important price movements automatically.</p>
            
            <form onSubmit={handleAddAlert} className="glass-card p-5 space-y-5">
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: "var(--text-2)" }}>Asset</label>
                <select 
                  className="w-full bg-transparent p-2.5 rounded-lg text-sm border focus:outline-none"
                  style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
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
                <label className="block text-xs font-semibold mb-2" style={{ color: "var(--text-2)" }}>Alert me when price drops/rises</label>
                <div className="flex bg-gray-800/50 p-1 rounded-lg" style={{ background: "var(--surface)" }}>
                  <button 
                    type="button"
                    className="flex-1 py-1.5 text-xs font-medium rounded-md transition-colors"
                    style={{ 
                      background: condition === "above" ? "var(--green-bg)" : "transparent",
                      color: condition === "above" ? "var(--green)" : "var(--text-3)" 
                    }}
                    onClick={() => setCondition("above")}
                  >
                    Goes Above
                  </button>
                  <button 
                    type="button"
                    className="flex-1 py-1.5 text-xs font-medium rounded-md transition-colors"
                    style={{ 
                      background: condition === "below" ? "var(--red-bg)" : "transparent",
                      color: condition === "below" ? "var(--red)" : "var(--text-3)" 
                    }}
                    onClick={() => setCondition("below")}
                  >
                    Drops Below
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: "var(--text-2)" }}>Target Price (USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-3)" }}>$</span>
                  <input 
                    type="number"
                    step="any"
                    required
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    placeholder={getCurrentPrice(selectedSymbol).toString()}
                    className="w-full bg-transparent py-2.5 pl-7 pr-3 rounded-lg text-sm font-mono focus:outline-none focus:ring-1"
                    style={{ color: "var(--text)", border: "1px solid var(--border)", backgroundColor: "var(--surface)" }}
                  />
                </div>
                <p className="text-[10px] mt-1.5" style={{ color: "var(--text-3)" }}>Current: {formatPrice(getCurrentPrice(selectedSymbol))}</p>
              </div>

              <button 
                type="submit" 
                disabled={watchlist.length === 0}
                className="w-full glow-btn py-3 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
              >
                Create Alert
              </button>
            </form>
          </div>

          {/* Right Col: Alerts List */}
          <div className="md:col-span-2 space-y-6 animate-fade-up" style={{ animationDelay: "100ms" }}>
            
            {/* Active Alerts */}
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: "var(--text)" }}>Active Alerts ({activeAlerts.length})</h3>
              
              {activeAlerts.length === 0 ? (
                <div className="glass-card p-8 text-center" style={{ borderStyle: "dashed" }}>
                  <p className="text-sm" style={{ color: "var(--text-3)" }}>No active alerts. Add one to start tracking.</p>
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
                      <div key={alert.id} className="glass-card p-4 flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: "var(--surface-2)" }}>
                            {findAsset(alert.symbol)?.icon || "📈"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{alert.symbol}</span>
                              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded" style={{
                                background: alert.condition === "above" ? "var(--green-bg)" : "var(--red-bg)",
                                color: alert.condition === "above" ? "var(--green)" : "var(--red)"
                              }}>{alert.condition}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs tabular-nums">
                              <span style={{ color: "var(--text-2)" }}>Target: <span className="font-bold text-white">${alert.targetPrice}</span></span>
                              <span style={{ color: "var(--text-3)" }}>•</span>
                              <span style={{ color: "var(--text-3)" }}>Now: {currentPrice > 0 ? formatPrice(currentPrice) : "Loading..."}</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] uppercase" style={{ color: "var(--text-3)" }}>Distance</p>
                            <p className="text-xs font-mono font-medium" style={{ color: diffPercent < 1 ? "var(--yellow)" : "var(--text-2)" }}>
                              {diffPercent.toFixed(2)}%
                            </p>
                          </div>
                          <button 
                            onClick={() => removeAlert(alert.id)}
                            className="p-2 rounded-md transition-colors opacity-50 hover:opacity-100 hover:bg-white/5"
                            style={{ color: "var(--red)" }}
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
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Triggered History</h3>
                </div>
                
                <div className="space-y-3 opacity-75">
                  {triggeredAlerts.map(alert => (
                    <div key={alert.id} className="glass-card p-4 flex items-center justify-between" style={{ borderLeft: "3px solid var(--accent)" }}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">🔔</span>
                        <div>
                          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                            <span className="font-bold">{alert.symbol}</span> crossed {alert.condition} <span className="font-bold">${alert.targetPrice}</span>
                          </p>
                          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                            Triggered on {new Date(alert.triggeredAt || alert.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => removeAlert(alert.id)} className="text-xs text-gray-500 hover:text-white">Clear</button>
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
