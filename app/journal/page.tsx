"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { useJournal, TradePosition, TradeEmotion, JournalEntry } from "@/hooks/useJournal";
import { useWatchlist } from "@/hooks/useWatchlist";
import { findAsset } from "@/lib/assetCatalog";
import TradePostMortem from "@/components/TradePostMortem";

function JournalContent() {
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
  const [exchangePnlPercent, setExchangePnlPercent] = useState<number | null>(null);
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
        if (data.exitPrice) setExitPrice(data.exitPrice.toString());
        if (data.leverage) setLeverage(data.leverage.toString());
        if (data.margin) setMargin(data.margin.toString());
        if (data.marginMode) setMarginMode(data.marginMode as "Cross" | "Isolated");
        if (typeof data.pnlPercent === "number") setExchangePnlPercent(data.pnlPercent);

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

    const parsedEntry = parseFloat(entryPrice.replace(/,/g, ''));
    const parsedExit = exitPrice ? parseFloat(exitPrice.replace(/,/g, '')) : undefined;

    addEntry({
      symbol,
      position,
      entryPrice: parsedEntry,
      exitPrice: parsedExit,
      emotion,
      notes,
      leverage: leverage ? parseFloat(leverage) : undefined,
      margin: margin ? parseFloat(margin.replace(/,/g, '')) : undefined,
      marginMode,
      pnlPercent: exchangePnlPercent ?? undefined,
      pnlSource: exchangePnlPercent !== null ? "exchange" : undefined,
    });

    // Reset form partially
    setEntryPrice("");
    setExitPrice("");
    setNotes("");
    setMargin("");
    setLeverage("");
    setExchangePnlPercent(null);
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
                      type="text" inputMode="decimal" placeholder="100"
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
                    type="text" inputMode="decimal" required
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
                    type="text" inputMode="decimal"
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
          <TimelineSection entries={entries} onRemove={removeEntry} onUpdate={updateEntry} clearJournal={clearJournal} />

        </div>
      </main>
    </div>
  );
}

export default function JournalPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center text-sm" style={{ color: "var(--text-3)", background: "var(--bg)" }}>Loading journal...</div>}>
      <JournalContent />
    </Suspense>
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
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    entryPrice: String(entry.entryPrice ?? ""),
    exitPrice: entry.exitPrice ? String(entry.exitPrice) : "",
    leverage: entry.leverage ? String(entry.leverage) : "",
    margin: entry.margin ? String(entry.margin) : "",
    marginMode: entry.marginMode || "Cross",
    position: entry.position,
    notes: entry.notes || "",
    feeRatePercent: typeof entry.feeRatePercent === "number" ? String(entry.feeRatePercent) : "",
  });

  const handleClose = () => {
    const cp = parseFloat(closePrice.replace(/,/g, ''));
    if (isNaN(cp) || cp <= 0) {
      alert("Please enter a valid Exit Price to close the trade and calculate PnL.");
      return;
    }
    onUpdate(entry.id, { exitPrice: cp });
  };

  const openEdit = () => {
    setEditForm({
      entryPrice: String(entry.entryPrice ?? ""),
      exitPrice: entry.exitPrice ? String(entry.exitPrice) : "",
      leverage: entry.leverage ? String(entry.leverage) : "",
      margin: entry.margin ? String(entry.margin) : "",
      marginMode: entry.marginMode || "Cross",
      position: entry.position,
      notes: entry.notes || "",
      feeRatePercent: typeof entry.feeRatePercent === "number" ? String(entry.feeRatePercent) : "",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    const parsedEntry = parseFloat(editForm.entryPrice.replace(/,/g, ""));
    if (isNaN(parsedEntry) || parsedEntry <= 0) {
      alert("Entry price is required.");
      return;
    }
    const parsedExit = editForm.exitPrice ? parseFloat(editForm.exitPrice.replace(/,/g, "")) : undefined;
    const parsedFee = editForm.feeRatePercent ? parseFloat(editForm.feeRatePercent) : undefined;
    const updates: Partial<JournalEntry> = {
      entryPrice: parsedEntry,
      exitPrice: parsedExit && parsedExit > 0 ? parsedExit : undefined,
      leverage: editForm.leverage ? parseFloat(editForm.leverage) : undefined,
      margin: editForm.margin ? parseFloat(editForm.margin.replace(/,/g, "")) : undefined,
      marginMode: editForm.marginMode as "Cross" | "Isolated",
      position: editForm.position,
      notes: editForm.notes,
      feeRatePercent: typeof parsedFee === "number" && !isNaN(parsedFee) ? parsedFee : undefined,
    };
    // If exit cleared, reset status to OPEN and drop pnl
    if (!updates.exitPrice) {
      updates.status = "OPEN";
      updates.pnlPercent = undefined;
    }
    onUpdate(entry.id, updates);
    setEditing(false);
  };

  return (
    <div className="glass-card p-4 relative group flex flex-col md:flex-row gap-4">
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={openEdit}
          title="Edit trade"
          className="p-1.5 rounded-md text-gray-400 hover:text-blue-300 hover:bg-white/5 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <button
          onClick={onRemove}
          title="Delete trade"
          className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-white/5 transition-colors"
        >
          ✕
        </button>
      </div>

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
            {entry.margin && (
              <span className="text-[10px] font-bold mt-1" style={{ color: isWin ? "var(--green)" : isLoss ? "var(--red)" : "var(--text-3)" }}>
                {isWin ? "+" : ""}{((entry.pnlPercent || 0) / 100 * entry.margin).toFixed(2)} USD
              </span>
            )}
            <span
              className="text-[9px] uppercase font-bold mt-1 px-1.5 py-0.5 rounded"
              style={{
                color: entry.pnlSource === "exchange" ? "var(--accent)" : "var(--text-3)",
                background: entry.pnlSource === "exchange" ? "var(--accent-dim)" : "transparent",
                opacity: entry.pnlSource === "exchange" ? 1 : 0.7,
              }}
              title={entry.pnlSource === "exchange" ? "PnL taken directly from exchange screenshot" : "PnL calculated from prices (fees auto-deducted)"}
            >
              {entry.pnlSource === "exchange" ? "EXCHANGE" : "NET PnL"}
            </span>
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

        {/* PnL breakdown: gross vs net vs fees (only for closed, computed trades) */}
        {!isOpen && typeof entry.grossPnlPercent === "number" && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>
            <div>
              <span>Gross: </span>
              <span style={{ color: entry.grossPnlPercent >= 0 ? "var(--green)" : "var(--red)" }}>
                {entry.grossPnlPercent >= 0 ? "+" : ""}{entry.grossPnlPercent.toFixed(2)}%
              </span>
            </div>
            {entry.leverage && (
              <div>
                <span>Fees: </span>
                <span style={{ color: "var(--red)" }}>−{((entry.feeRatePercent ?? 0.05) * 2 * entry.leverage).toFixed(2)}%</span>
                <span className="opacity-60"> ({(entry.feeRatePercent ?? 0.05).toFixed(2)}% × 2 × {entry.leverage}x)</span>
              </div>
            )}
            {entry.pnlSource === "exchange" && typeof entry.grossPnlPercent === "number" && typeof entry.pnlPercent === "number" && (
              <div>
                <span>Exchange PnL: </span>
                <span style={{ color: entry.pnlPercent >= 0 ? "var(--green)" : "var(--red)" }}>
                  {entry.pnlPercent >= 0 ? "+" : ""}{entry.pnlPercent.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        <p className="text-[11px] leading-relaxed p-2.5 rounded-md mb-2" style={{ background: "var(--surface)", color: "var(--text-2)" }}>
          {entry.notes}
        </p>

        {/* Close Trade Action for OPEN trades */}
        {isOpen && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            <span className="text-[10px] uppercase" style={{ color: "var(--text-3)" }}>Close Trade:</span>
            <input 
              type="text" inputMode="decimal" placeholder="Exit Price"
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

        {editing && (
          <div className="mt-3 rounded-xl p-3 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-strong)" }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>Edit Trade</span>
              <button onClick={() => setEditing(false)} className="text-[11px]" style={{ color: "var(--text-3)" }}>Cancel</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <EditField label="Entry Price" value={editForm.entryPrice} onChange={(v) => setEditForm((f) => ({ ...f, entryPrice: v }))} prefix="$" />
              <EditField label="Exit Price" value={editForm.exitPrice} onChange={(v) => setEditForm((f) => ({ ...f, exitPrice: v }))} prefix="$" placeholder="blank = open" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <EditField label="Leverage" value={editForm.leverage} onChange={(v) => setEditForm((f) => ({ ...f, leverage: v }))} suffix="x" />
              <EditField label="Margin" value={editForm.margin} onChange={(v) => setEditForm((f) => ({ ...f, margin: v }))} prefix="$" />
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Mode</label>
                <select
                  value={editForm.marginMode}
                  onChange={(e) => setEditForm((f) => ({ ...f, marginMode: e.target.value as "Cross" | "Isolated" }))}
                  className="bg-transparent p-2 rounded-lg text-xs font-semibold focus:outline-none border"
                  style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
                >
                  <option value="Cross">Cross</option>
                  <option value="Isolated">Isolated</option>
                </select>
              </div>
            </div>

            <EditField
              label="Taker Fee (per side, %) — leave blank for default 0.05%"
              value={editForm.feeRatePercent}
              onChange={(v) => setEditForm((f) => ({ ...f, feeRatePercent: v }))}
              suffix="%"
              placeholder="0.05"
            />

            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Position</label>
              <div className="flex gap-2">
                {(["LONG", "SHORT", "SPOT"] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, position: pos }))}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 hover:scale-105"
                    style={{
                      background: editForm.position === pos ? (pos === "LONG" ? "var(--green-bg)" : pos === "SHORT" ? "var(--red-bg)" : "var(--surface-active)") : "var(--surface-2)",
                      border: `1px solid ${editForm.position === pos ? (pos === "LONG" ? "var(--green)" : pos === "SHORT" ? "var(--red)" : "var(--accent)") : "var(--border)"}`,
                      color: editForm.position === pos ? (pos === "LONG" ? "var(--green)" : pos === "SHORT" ? "var(--red)" : "var(--accent)") : "var(--text-2)",
                    }}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Notes</label>
              <textarea
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full bg-transparent p-2 rounded-lg text-xs resize-none border focus:outline-none"
                style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={saveEdit}
                className="glow-btn py-2 px-4 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 hover:scale-[1.02] active:scale-95"
              >
                Save Changes
              </button>
              <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
                PnL is auto-recalculated
              </span>
            </div>
          </div>
        )}

        <TradePostMortem entry={entry} onUpdate={onUpdate} />
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, prefix, suffix, placeholder }: { label: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: "var(--text-3)" }}>{prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent p-2 rounded-lg text-xs font-mono focus:outline-none border"
          style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)", paddingLeft: prefix ? "1.4rem" : undefined, paddingRight: suffix ? "1.4rem" : undefined }}
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: "var(--text-3)" }}>{suffix}</span>}
      </div>
    </div>
  );
}

type TimelineTab = "all" | "open" | "closed";

function TimelineSection({
  entries,
  onRemove,
  onUpdate,
  clearJournal,
}: {
  entries: JournalEntry[];
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<JournalEntry>) => void;
  clearJournal: () => void;
}) {
  const [tab, setTab] = useState<TimelineTab>("all");

  const stats = useMemo(() => {
    const closed = entries.filter((e) => e.status === "CLOSED");
    const open = entries.filter((e) => e.status === "OPEN");
    const wins = closed.filter((e) => (e.pnlPercent || 0) > 0);
    const losses = closed.filter((e) => (e.pnlPercent || 0) < 0);

    let totalInvested = 0;
    let netPnlUsd = 0;
    let totalProfitUsd = 0;
    let totalLossUsd = 0;
    let openExposure = 0;

    entries.forEach((e) => {
      const margin = e.margin || 0;
      totalInvested += margin;
      if (e.status === "OPEN") openExposure += margin;
      if (e.status === "CLOSED" && typeof e.pnlPercent === "number" && margin) {
        const pnlUsd = (e.pnlPercent / 100) * margin;
        netPnlUsd += pnlUsd;
        if (pnlUsd >= 0) totalProfitUsd += pnlUsd;
        else totalLossUsd += pnlUsd;
      }
    });

    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const avgPnlPercent = closed.length > 0
      ? closed.reduce((sum, e) => sum + (e.pnlPercent || 0), 0) / closed.length
      : 0;

    return {
      total: entries.length,
      closedCount: closed.length,
      openCount: open.length,
      winsCount: wins.length,
      lossesCount: losses.length,
      winRate,
      avgPnlPercent,
      totalInvested,
      openExposure,
      netPnlUsd,
      totalProfitUsd,
      totalLossUsd,
    };
  }, [entries]);

  const filtered = useMemo(() => {
    if (tab === "open") return entries.filter((e) => e.status === "OPEN");
    if (tab === "closed") return entries.filter((e) => e.status === "CLOSED");
    return entries;
  }, [entries, tab]);

  const fmtUsd = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
  const netTone = stats.netPnlUsd > 0 ? "var(--green)" : stats.netPnlUsd < 0 ? "var(--red)" : "var(--text)";

  return (
    <div className="xl:col-span-8 animate-fade-up flex flex-col gap-5" style={{ animationDelay: "100ms" }}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold" style={{ color: "var(--text)" }}>Trade Timeline</h2>
        {entries.length > 0 && (
          <button
            onClick={() => { if (window.confirm("Clear entire journal?")) clearJournal(); }}
            className="text-xs font-semibold transition-all duration-200 hover:scale-105"
            style={{ color: "var(--red)" }}
          >
            Clear Log
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <div className="glass-card p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold px-2 py-1 rounded-md uppercase tracking-wider" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
                Performance
              </span>
              <span className="text-xs" style={{ color: "var(--text-3)" }}>
                {stats.closedCount} closed · {stats.openCount} open
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Net PnL</span>
              <span className="text-lg font-bold tabular-nums" style={{ color: netTone }}>
                {fmtUsd(stats.netPnlUsd)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatTile label="Total Trades" value={String(stats.total)} sub={`${stats.closedCount} closed`} />
            <StatTile label="Win Rate" value={`${stats.winRate.toFixed(0)}%`} sub={`${stats.winsCount}W · ${stats.lossesCount}L`} tone={stats.winRate >= 50 ? "green" : stats.winRate > 0 ? "red" : "neutral"} />
            <StatTile label="Avg PnL" value={`${stats.avgPnlPercent >= 0 ? "+" : ""}${stats.avgPnlPercent.toFixed(2)}%`} sub="per closed trade" tone={stats.avgPnlPercent >= 0 ? "green" : "red"} />
            <StatTile label="Total Invested" value={`$${stats.totalInvested.toFixed(2)}`} sub={`Open: $${stats.openExposure.toFixed(2)}`} />
          </div>

          {stats.closedCount > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl px-3 py-2.5 flex items-center justify-between transition-all duration-200 hover:scale-[1.01]" style={{ background: "rgba(52, 211, 153, 0.08)", border: "1px solid rgba(52, 211, 153, 0.18)" }}>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Total Profit</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: "var(--green)" }}>+${stats.totalProfitUsd.toFixed(2)}</span>
              </div>
              <div className="rounded-xl px-3 py-2.5 flex items-center justify-between transition-all duration-200 hover:scale-[1.01]" style={{ background: "rgba(248, 113, 113, 0.08)", border: "1px solid rgba(248, 113, 113, 0.18)" }}>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Total Loss</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: "var(--red)" }}>−${Math.abs(stats.totalLossUsd).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="glass-card p-12 text-center" style={{ borderStyle: "dashed" }}>
          <span className="text-4xl mb-3 block opacity-50">📓</span>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>Your journal is empty. Log a trade or upload a screenshot.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
            <TimelineTabPill label="All" count={stats.total} active={tab === "all"} onClick={() => setTab("all")} />
            <TimelineTabPill label="Open" count={stats.openCount} active={tab === "open"} onClick={() => setTab("open")} tone="accent" />
            <TimelineTabPill label="Closed" count={stats.closedCount} active={tab === "closed"} onClick={() => setTab("closed")} tone="neutral" />
          </div>

          {filtered.length === 0 ? (
            <div className="glass-card p-8 text-center" style={{ borderStyle: "dashed" }}>
              <p className="text-sm" style={{ color: "var(--text-3)" }}>
                No {tab} trades yet.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filtered.map((entry) => (
                <JournalCard key={entry.id} entry={entry} onRemove={() => onRemove(entry.id)} onUpdate={onUpdate} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" | "red" | "neutral" }) {
  const valueColor = tone === "green" ? "var(--green)" : tone === "red" ? "var(--red)" : "var(--text)";
  return (
    <div className="rounded-xl px-3 py-3 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))", border: "1px solid var(--border)" }}>
      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>{label}</p>
      <p className="text-base font-bold tabular-nums" style={{ color: valueColor }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>{sub}</p>}
    </div>
  );
}

function TimelineTabPill({ label, count, active, onClick, tone }: { label: string; count: number; active: boolean; onClick: () => void; tone?: "accent" | "neutral" }) {
  const activeStyles = tone === "accent"
    ? { background: "var(--accent-dim)", border: "1px solid var(--accent)", color: "var(--accent)", boxShadow: "0 0 12px rgba(82,170,255,0.18)" }
    : { background: "var(--surface-active)", border: "1px solid var(--border-strong)", color: "var(--text)" };

  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-2 transition-all duration-200 hover:scale-105 active:scale-95"
      style={active ? activeStyles : { background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-2)" }}
    >
      <span>{label}</span>
      <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ background: active ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.05)", color: "inherit" }}>
        {count}
      </span>
    </button>
  );
}
