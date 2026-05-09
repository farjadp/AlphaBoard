"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { useJournal, TradePosition, TradeEmotion, JournalEntry } from "@/hooks/useJournal";
import { useWatchlist } from "@/hooks/useWatchlist";
import { findAsset } from "@/lib/assetCatalog";

export default function JournalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { entries, addEntry, removeEntry, updateEntry, clearJournal } = useJournal();
  const { watchlist, symbols } = useWatchlist();

  // Form State
  const [symbol, setSymbol] = useState<string>(symbols[0] || "");
  const [position, setPosition] = useState<TradePosition>("LONG");
  const [entryPrice, setEntryPrice] = useState<string>("");
  const [exitPrice, setExitPrice] = useState<string>("");
  const [emotion, setEmotion] = useState<TradeEmotion>("Neutral");
  const [notes, setNotes] = useState<string>("");
  const [leverage, setLeverage] = useState<string>("");
  const [margin, setMargin] = useState<string>("");
  const [marginMode, setMarginMode] = useState<"Cross" | "Isolated">("Cross");

  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill from URL if coming from Archive
  useEffect(() => {
    const s = searchParams.get("symbol");
    const pos = searchParams.get("position") as TradePosition;
    const ep = searchParams.get("entry");
    const xp = searchParams.get("exit");
    
    if (s && symbols.includes(s)) setSymbol(s);
    if (pos) setPosition(pos);
    if (ep) setEntryPrice(ep);
    if (xp) setExitPrice(xp);
  }, [searchParams, symbols]);

  // Handle AI Screenshot Parsing
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Image = reader.result as string;
        
        const res = await fetch("/api/parse-screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64Image })
        });
        
        if (!res.ok) throw new Error("Failed to parse image");
        
        const data = await res.json();
        
        if (data.symbol) {
          // Try to match symbol cleanly (e.g. BTCUSDT -> BTC/USDT)
          const cleanSym = data.symbol.replace("/", "");
          const matched = symbols.find(s => s.replace("/", "") === cleanSym);
          if (matched) setSymbol(matched);
        }
        if (data.position) setPosition(data.position as TradePosition);
        if (data.entryPrice) setEntryPrice(data.entryPrice.toString());
        if (data.leverage) setLeverage(data.leverage.toString());
        if (data.margin) setMargin(data.margin.toString());
        if (data.marginMode) setMarginMode(data.marginMode as "Cross" | "Isolated");
        
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setIsUploading(false);
      alert("Failed to parse screenshot.");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !entryPrice) return;

    addEntry({
      symbol,
      position,
      entryPrice: parseFloat(entryPrice),
      exitPrice: exitPrice ? parseFloat(exitPrice) : undefined,
      emotion,
      notes,
      leverage: leverage ? parseFloat(leverage) : undefined,
      margin: margin ? parseFloat(margin) : undefined,
      marginMode,
    });

    // Reset form partially
    setEntryPrice("");
    setExitPrice("");
    setNotes("");
    setMargin("");
    setLeverage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    router.replace("/journal");
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <NavBar />
      
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-8">
          
          {/* Left Col: Journal Form */}
          <div className="xl:col-span-4 space-y-6 animate-fade-up">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>Trading Journal</h1>
              <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>Log trades, upload PnL screenshots, track emotional patterns.</p>
            </div>

            <div 
              className="glass-card p-4 flex flex-col items-center justify-center text-center cursor-pointer border-dashed border-2 hover:bg-white/5 transition-colors relative"
              style={{ borderColor: "var(--border)" }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
              <span className="text-2xl mb-2">📸</span>
              <h4 className="text-sm font-bold" style={{ color: "var(--text)" }}>Auto-Fill from Screenshot</h4>
              <p className="text-[10px]" style={{ color: "var(--text-3)" }}>Upload Binance/Bybit position image to use AI Vision.</p>
              
              {isUploading && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center rounded-xl">
                  <span className="text-sm font-bold animate-pulse text-blue-400">AI Parsing...</span>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="glass-card p-5 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>Asset</label>
                  <select 
                    required className="w-full bg-transparent p-2.5 rounded-lg text-sm font-semibold focus:outline-none border"
                    style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                    value={symbol} onChange={(e) => setSymbol(e.target.value)}
                  >
                    <option value="" disabled>Select Asset</option>
                    {watchlist.map(a => <option key={a.symbol} value={a.symbol}>{a.symbol}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>Position</label>
                  <select 
                    className="w-full bg-transparent p-2.5 rounded-lg text-sm font-semibold focus:outline-none border"
                    style={{ color: position === "LONG" ? "var(--green)" : position === "SHORT" ? "var(--red)" : "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                    value={position} onChange={(e) => setPosition(e.target.value as TradePosition)}
                  >
                    <option value="LONG">Long</option>
                    <option value="SHORT">Short</option>
                    <option value="SPOT">Spot</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>Mode</label>
                  <select 
                    className="w-full bg-transparent p-2.5 rounded-lg text-xs font-semibold focus:outline-none border"
                    style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                    value={marginMode} onChange={(e) => setMarginMode(e.target.value as "Cross" | "Isolated")}
                  >
                    <option value="Cross">Cross</option>
                    <option value="Isolated">Isolated</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>Leverage</label>
                  <div className="relative">
                    <input 
                      type="number" step="any" placeholder="10"
                      value={leverage} onChange={(e) => setLeverage(e.target.value)}
                      className="w-full bg-transparent p-2.5 pr-6 rounded-lg text-sm font-mono focus:outline-none border"
                      style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">x</span>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>Margin</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">$</span>
                    <input 
                      type="number" step="any" placeholder="100"
                      value={margin} onChange={(e) => setMargin(e.target.value)}
                      className="w-full bg-transparent p-2.5 pl-6 rounded-lg text-sm font-mono focus:outline-none border"
                      style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>Entry Price</label>
                  <input 
                    type="number" step="any" required
                    value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)}
                    className="w-full bg-transparent p-2.5 rounded-lg text-sm font-mono focus:outline-none border"
                    style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>
                    Exit Price <span className="opacity-50">(Optional)</span>
                  </label>
                  <input 
                    type="number" step="any"
                    value={exitPrice} onChange={(e) => setExitPrice(e.target.value)}
                    placeholder="Leave blank for OPEN"
                    className="w-full bg-transparent p-2.5 rounded-lg text-sm font-mono focus:outline-none border placeholder-gray-600"
                    style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>Emotion</label>
                <div className="flex flex-wrap gap-2">
                  {["Confident", "Neutral", "FOMO", "Panic", "Greed", "Revenge"].map((emo) => (
                    <button
                      key={emo} type="button"
                      onClick={() => setEmotion(emo as TradeEmotion)}
                      className="px-2 py-1 text-[11px] font-medium rounded transition-colors"
                      style={{
                        background: emotion === emo ? "var(--surface-active)" : "var(--surface)",
                        border: emotion === emo ? "1px solid var(--accent)" : "1px solid var(--border)",
                        color: emotion === emo ? "var(--accent)" : "var(--text-2)"
                      }}
                    >
                      {emo}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--text-3)" }}>Trade Notes / Lessons</label>
                <textarea 
                  required rows={3}
                  value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Why did you take this trade? Mistakes?"
                  className="w-full bg-transparent p-3 rounded-lg text-sm focus:outline-none resize-none border"
                  style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                />
              </div>

              <button type="submit" className="w-full glow-btn py-3 text-xs font-bold uppercase tracking-wider">
                Log Trade
              </button>
            </form>
          </div>

          {/* Right Col: Timeline */}
          <div className="xl:col-span-8 animate-fade-up" style={{ animationDelay: "100ms" }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>Trade Timeline</h2>
              {entries.length > 0 && (
                <button onClick={() => { if(window.confirm("Clear entire journal?")) clearJournal(); }} className="text-xs text-red-500 hover:underline">
                  Clear Log
                </button>
              )}
            </div>

            {entries.length === 0 ? (
              <div className="glass-card p-12 text-center" style={{ borderStyle: "dashed" }}>
                <span className="text-4xl mb-3 block opacity-50">📓</span>
                <p className="text-sm" style={{ color: "var(--text-3)" }}>Your journal is empty. Log a trade or upload a screenshot.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {entries.map((entry) => (
                  <JournalCard key={entry.id} entry={entry} onRemove={() => removeEntry(entry.id)} onUpdate={updateEntry} />
                ))}
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}

function JournalCard({ entry, onRemove, onUpdate }: { entry: JournalEntry, onRemove: () => void, onUpdate: (id: string, updates: Partial<JournalEntry>) => void }) {
  const asset = findAsset(entry.symbol);
  const date = new Date(entry.timestamp);
  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  
  const isOpen = entry.status === "OPEN";
  const isWin = !isOpen && (entry.pnlPercent || 0) > 0;
  const isLoss = !isOpen && (entry.pnlPercent || 0) < 0;

  const [closePrice, setClosePrice] = useState("");

  const handleClose = () => {
    const cp = parseFloat(closePrice);
    if (!isNaN(cp) && cp > 0) {
      onUpdate(entry.id, { exitPrice: cp });
    }
  };

  return (
    <div className="glass-card p-4 relative group flex flex-col md:flex-row gap-4">
      <button 
        onClick={onRemove}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-white/5 text-gray-500 hover:text-red-400"
      >
        ✕
      </button>

      {/* PnL / Status Sidebar */}
      <div className="w-full md:w-24 shrink-0 flex flex-col items-center justify-center text-center p-3 rounded-lg" 
           style={{ background: isOpen ? "var(--surface-active)" : isWin ? "var(--green-bg)" : isLoss ? "var(--red-bg)" : "var(--surface-2)",
                    border: isOpen ? "1px solid var(--accent)" : "none" }}>
        {isOpen ? (
          <span className="text-xs font-bold text-blue-400 tracking-wider">OPEN</span>
        ) : (
          <>
            <span className="text-sm font-bold tabular-nums" style={{ color: isWin ? "var(--green)" : isLoss ? "var(--red)" : "var(--text)" }}>
              {isWin ? "+" : ""}{(entry.pnlPercent || 0).toFixed(2)}%
            </span>
            <span className="text-[10px] uppercase font-bold mt-1" style={{ color: "var(--text-3)" }}>PnL</span>
          </>
        )}
      </div>

      <div className="flex-1">
        {/* Header Row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex items-center gap-1.5 mr-2">
            <span style={{ fontSize: "14px" }}>{asset?.icon || "📈"}</span>
            <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{entry.symbol}</span>
          </div>
          
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{
            background: entry.position === "LONG" ? "var(--green-bg)" : entry.position === "SHORT" ? "var(--red-bg)" : "var(--surface)",
            color: entry.position === "LONG" ? "var(--green)" : entry.position === "SHORT" ? "var(--red)" : "var(--text)"
          }}>{entry.position}</span>

          {entry.leverage && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-800 text-yellow-500">
              {entry.leverage}x
            </span>
          )}
          {entry.marginMode && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">
              {entry.marginMode}
            </span>
          )}

          <span className="text-[9px] px-1.5 py-0.5 rounded border ml-2" style={{ borderColor: "var(--border)", color: "var(--text-3)" }}>
            {entry.emotion}
          </span>

          <span className="text-[10px] ml-auto" style={{ color: "var(--text-3)" }}>
            {formattedDate}
          </span>
        </div>

        {/* Trade Details */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-3 text-xs tabular-nums font-mono" style={{ color: "var(--text-2)" }}>
          <div><span style={{ color: "var(--text-3)" }}>Entry:</span> ${entry.entryPrice}</div>
          {entry.exitPrice && <div><span style={{ color: "var(--text-3)" }}>Exit:</span> ${entry.exitPrice}</div>}
          
          {entry.margin && (
            <div><span style={{ color: "var(--text-3)" }}>Margin:</span> ${entry.margin}</div>
          )}
          {entry.margin && entry.leverage && (
            <div><span style={{ color: "var(--text-3)" }}>Size:</span> ${(entry.margin * entry.leverage).toFixed(2)}</div>
          )}
        </div>

        {/* Notes */}
        <p className="text-[11px] leading-relaxed p-2.5 rounded-md mb-2" style={{ background: "var(--surface)", color: "var(--text-2)" }}>
          {entry.notes}
        </p>

        {/* Close Trade Action for OPEN trades */}
        {isOpen && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            <span className="text-[10px] uppercase" style={{ color: "var(--text-3)" }}>Close Trade:</span>
            <input 
              type="number" step="any" placeholder="Exit Price"
              value={closePrice} onChange={(e) => setClosePrice(e.target.value)}
              className="bg-transparent p-1 px-2 rounded text-xs font-mono focus:outline-none border"
              style={{ color: "var(--text)", borderColor: "var(--border)" }}
            />
            <button 
              onClick={handleClose}
              className="px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors"
              style={{ background: "var(--surface-active)", color: "var(--accent)" }}
            >
              Update PnL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
