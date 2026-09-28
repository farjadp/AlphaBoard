"use client";

import { useState, useRef, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { useJournal, TradePosition, TradeEmotion, JournalEntry } from "@/hooks/useJournal";
import { useWatchlist } from "@/hooks/useWatchlist";
import { findAsset } from "@/lib/assetCatalog";
import TradePostMortem from "@/components/TradePostMortem";
import { compressImage } from "@/lib/client/image";
import { apiErrorMessage } from "@/lib/client/apiError";

const INPUT =
  "w-full rounded-lg border border-line bg-paper text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";

function JournalContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { entries, addEntry, removeEntry, updateEntry, clearJournal, storageError } = useJournal();
  const { watchlist, symbols } = useWatchlist();

  // Form State
  // Pre-filled from the URL when arriving from the Strategy Archive ("Log this trade").
  const [symbol, setSymbol] = useState<string>(() => {
    const s = searchParams.get("symbol");
    return s && findAsset(s) ? s : symbols[0] || "";
  });
  const [position, setPosition] = useState<TradePosition>(() => {
    const p = searchParams.get("position");
    return p === "SHORT" || p === "SPOT" ? p : "LONG";
  });
  const [entryPrice, setEntryPrice] = useState<string>(() => searchParams.get("entry") ?? "");
  const [exitPrice, setExitPrice] = useState<string>(() => searchParams.get("exit") ?? "");
  const [emotion, setEmotion] = useState<TradeEmotion>("Neutral");
  const [notes, setNotes] = useState<string>("");
  const [leverage, setLeverage] = useState<string>("");
  const [margin, setMargin] = useState<string>("");
  const [marginMode, setMarginMode] = useState<"Cross" | "Isolated">("Cross");

  const [isUploading, setIsUploading] = useState(false);
  const [exchangePnlPercent, setExchangePnlPercent] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);


  // Handle AI Screenshot Parsing
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // v1 did this inside FileReader.onloadend, so any failure escaped the try/catch and left the
      // uploader spinning forever. Compress first (≤1.5 MB), then await the parse directly.
      const image = await compressImage(file);
      const res = await fetch("/api/parse-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Failed to read the screenshot"));
      const data = await res.json();
      {
        
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
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to read the screenshot.");
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = "";
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
    <div className="flex h-screen flex-col overflow-hidden bg-page">
      <NavBar />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-8 xl:grid-cols-12">

          {/* Left Col: Journal Form */}
          <div className="animate-fade-up space-y-6 xl:col-span-4">
            <div>
              <h1 className="font-display text-2xl font-extrabold text-ink">Trading Journal</h1>
              <p className="mt-1 text-sm text-ink-3">Log trades, upload PnL screenshots, track emotional patterns.</p>
            </div>

            {storageError && (
              <div role="alert" className="rounded-lg border border-down/30 bg-down-soft p-3 text-xs text-down">
                {storageError}
              </div>
            )}

            <div
              className="relative flex cursor-pointer flex-col items-center justify-center rounded-[14px] border-2 border-dashed border-line-2 bg-paper p-4 text-center transition-colors hover:bg-wash"
              onClick={() => fileInputRef.current?.click()}
            >
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
              <h4 className="text-sm font-bold text-ink">Auto-Fill from Screenshot</h4>
              <p className="mt-0.5 text-[10px] text-ink-3">Upload Binance/Bybit position image to use AI Vision.</p>

              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-[14px] bg-paper/90">
                  <span className="animate-pulse text-sm font-bold text-accent">AI Parsing...</span>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="panel space-y-5 p-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-caps mb-2 block">Asset</label>
                  <select
                    required className={`${INPUT} p-2.5 text-sm font-semibold`}
                    value={symbol} onChange={(e) => setSymbol(e.target.value)}
                  >
                    <option value="" disabled>Select Asset</option>
                    {watchlist.map(a => <option key={a.symbol} value={a.symbol}>{a.symbol}</option>)}
                    {symbol && !watchlist.some((a) => a.symbol === symbol) && <option value={symbol}>{symbol}</option>}
                  </select>
                </div>
                <div>
                  <label className="label-caps mb-2 block">Position</label>
                  <select
                    className={`${INPUT} p-2.5 text-sm font-semibold ${position === "LONG" ? "text-up" : position === "SHORT" ? "text-down" : "text-ink"}`}
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
                  <label className="label-caps mb-2 block">Mode</label>
                  <select
                    className={`${INPUT} p-2.5 text-xs font-semibold`}
                    value={marginMode} onChange={(e) => setMarginMode(e.target.value as "Cross" | "Isolated")}
                  >
                    <option value="Cross">Cross</option>
                    <option value="Isolated">Isolated</option>
                  </select>
                </div>
                <div>
                  <label className="label-caps mb-2 block">Leverage</label>
                  <div className="relative">
                    <input
                      type="number" step="any" placeholder="10"
                      value={leverage} onChange={(e) => setLeverage(e.target.value)}
                      className={`${INPUT} num p-2.5 pr-6 text-sm`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">x</span>
                  </div>
                </div>
                <div>
                  <label className="label-caps mb-2 block">Margin</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-3">$</span>
                    <input
                      type="text" inputMode="decimal" placeholder="100"
                      value={margin} onChange={(e) => setMargin(e.target.value)}
                      className={`${INPUT} num p-2.5 pl-6 text-sm`}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-caps mb-2 block">Entry Price</label>
                  <input
                    type="text" inputMode="decimal" required
                    value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)}
                    className={`${INPUT} num p-2.5 text-sm`}
                  />
                </div>
                <div>
                  <label className="label-caps mb-2 block">
                    Exit Price <span className="opacity-60">(Optional)</span>
                  </label>
                  <input
                    type="text" inputMode="decimal"
                    value={exitPrice} onChange={(e) => setExitPrice(e.target.value)}
                    placeholder="Leave blank for OPEN"
                    className={`${INPUT} num p-2.5 text-sm`}
                  />
                </div>
              </div>

              <div>
                <label className="label-caps mb-2 block">Emotion</label>
                <div className="flex flex-wrap gap-2">
                  {["Confident", "Neutral", "FOMO", "Panic", "Greed", "Revenge"].map((emo) => (
                    <button
                      key={emo} type="button"
                      onClick={() => setEmotion(emo as TradeEmotion)}
                      className={`rounded border px-2 py-1 text-[11px] font-semibold transition-colors ${
                        emotion === emo
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line bg-paper text-ink-2 hover:bg-wash"
                      }`}
                    >
                      {emo}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label-caps mb-2 block">Trade Notes / Lessons</label>
                <textarea
                  required rows={3}
                  value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Why did you take this trade? Mistakes?"
                  className={`${INPUT} resize-none p-3 text-sm`}
                />
              </div>

              <button type="submit" className="w-full rounded-lg bg-ink py-3 text-xs font-bold uppercase tracking-wider text-paper transition-colors hover:bg-[#23313f]">
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
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-page text-sm text-ink-3">Loading journal...</div>}>
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

  const sidebarTone = isOpen ? "bg-accent-soft" : isWin ? "bg-up-soft" : isLoss ? "bg-down-soft" : "bg-wash";
  const pnlTone = isWin ? "text-up" : isLoss ? "text-down" : "text-ink";
  const pnlSubTone = isWin ? "text-up" : isLoss ? "text-down" : "text-ink-3";
  const positionTone = entry.position === "LONG" ? "bg-up-soft text-up" : entry.position === "SHORT" ? "bg-down-soft text-down" : "bg-wash text-ink";

  return (
    <div className="panel group relative flex flex-col gap-4 p-4 md:flex-row">
      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={openEdit}
          title="Edit trade"
          className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-wash hover:text-accent"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <button
          onClick={onRemove}
          title="Delete trade"
          className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-down-soft hover:text-down"
        >
          ✕
        </button>
      </div>

      {/* PnL / Status Sidebar */}
      <div className={`flex w-full shrink-0 flex-col items-center justify-center rounded-lg p-3 text-center md:w-24 ${sidebarTone}`}>
        {isOpen ? (
          <span className="text-xs font-bold tracking-wider text-accent">OPEN</span>
        ) : (
          <>
            <span className={`num text-sm font-bold ${pnlTone}`}>
              {isWin ? "+" : ""}{(entry.pnlPercent || 0).toFixed(2)}%
            </span>
            {entry.margin && (
              <span className={`num mt-1 text-[10px] font-bold ${pnlSubTone}`}>
                {isWin ? "+" : ""}{((entry.pnlPercent || 0) / 100 * entry.margin).toFixed(2)} USD
              </span>
            )}
            <span
              className={`mt-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                entry.pnlSource === "exchange" ? "bg-accent-soft text-accent" : "text-ink-3"
              }`}
              title={entry.pnlSource === "exchange" ? "PnL taken directly from exchange screenshot" : "PnL calculated from prices (fees auto-deducted)"}
            >
              {entry.pnlSource === "exchange" ? "EXCHANGE" : "NET PnL"}
            </span>
          </>
        )}
      </div>

      <div className="flex-1">
        {/* Header Row */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-2 flex items-center gap-1.5">
            <span className="text-sm">{asset?.icon || "📈"}</span>
            <span className="text-sm font-bold text-ink">{entry.symbol}</span>
          </div>

          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${positionTone}`}>{entry.position}</span>

          {entry.leverage && (
            <span className="num rounded bg-amber-soft px-1.5 py-0.5 text-[9px] font-bold text-amber">
              {entry.leverage}x
            </span>
          )}
          {entry.marginMode && (
            <span className="rounded bg-wash px-1.5 py-0.5 text-[9px] font-bold text-ink-2">
              {entry.marginMode}
            </span>
          )}

          <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[9px] text-ink-3">
            {entry.emotion}
          </span>

          <span className="ml-auto text-[10px] text-ink-3">
            {formattedDate}
          </span>
        </div>

        {/* Trade Details */}
        <div className="num mb-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink-2">
          <div><span className="text-ink-3">Entry:</span> ${entry.entryPrice}</div>
          {entry.exitPrice && <div><span className="text-ink-3">Exit:</span> ${entry.exitPrice}</div>}

          {entry.margin && (
            <div><span className="text-ink-3">Margin:</span> ${entry.margin}</div>
          )}
          {entry.margin && entry.leverage && (
            <div><span className="text-ink-3">Size:</span> ${(entry.margin * entry.leverage).toFixed(2)}</div>
          )}
        </div>

        {/* PnL breakdown: gross vs net vs fees (only for closed, computed trades) */}
        {!isOpen && typeof entry.grossPnlPercent === "number" && (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] tabular-nums text-ink-3">
            <div>
              <span>Gross: </span>
              <span className={entry.grossPnlPercent >= 0 ? "text-up" : "text-down"}>
                {entry.grossPnlPercent >= 0 ? "+" : ""}{entry.grossPnlPercent.toFixed(2)}%
              </span>
            </div>
            {entry.leverage && (
              <div>
                <span>Fees: </span>
                <span className="text-down">−{((entry.feeRatePercent ?? 0.05) * 2 * entry.leverage).toFixed(2)}%</span>
                <span className="opacity-70"> ({(entry.feeRatePercent ?? 0.05).toFixed(2)}% × 2 × {entry.leverage}x)</span>
              </div>
            )}
            {entry.pnlSource === "exchange" && typeof entry.grossPnlPercent === "number" && typeof entry.pnlPercent === "number" && (
              <div>
                <span>Exchange PnL: </span>
                <span className={entry.pnlPercent >= 0 ? "text-up" : "text-down"}>
                  {entry.pnlPercent >= 0 ? "+" : ""}{entry.pnlPercent.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        <p className="mb-2 rounded-md bg-wash p-2.5 text-[11px] leading-relaxed text-ink-2">
          {entry.notes}
        </p>

        {/* Close Trade Action for OPEN trades */}
        {isOpen && (
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <span className="label-caps">Close Trade:</span>
            <input
              type="text" inputMode="decimal" placeholder="Exit Price"
              value={closePrice} onChange={(e) => setClosePrice(e.target.value)}
              className="num rounded border border-line bg-paper p-1 px-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <button
              onClick={handleClose}
              className="rounded border border-line-2 px-3 py-1 text-[10px] font-bold uppercase text-ink transition-colors hover:bg-wash"
            >
              Update PnL
            </button>
          </div>
        )}

        {editing && (
          <div className="mt-3 flex flex-col gap-3 rounded-lg bg-wash p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-ink">Edit Trade</span>
              <button onClick={() => setEditing(false)} className="text-[11px] font-semibold text-ink-3 hover:text-ink">Cancel</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <EditField label="Entry Price" value={editForm.entryPrice} onChange={(v) => setEditForm((f) => ({ ...f, entryPrice: v }))} prefix="$" />
              <EditField label="Exit Price" value={editForm.exitPrice} onChange={(v) => setEditForm((f) => ({ ...f, exitPrice: v }))} prefix="$" placeholder="blank = open" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <EditField label="Leverage" value={editForm.leverage} onChange={(v) => setEditForm((f) => ({ ...f, leverage: v }))} suffix="x" />
              <EditField label="Margin" value={editForm.margin} onChange={(v) => setEditForm((f) => ({ ...f, margin: v }))} prefix="$" />
              <div className="flex flex-col gap-1">
                <label className="label-caps">Mode</label>
                <select
                  value={editForm.marginMode}
                  onChange={(e) => setEditForm((f) => ({ ...f, marginMode: e.target.value as "Cross" | "Isolated" }))}
                  className={`${INPUT} p-2 text-xs font-semibold`}
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
              <label className="label-caps">Position</label>
              <div className="flex gap-2">
                {(["LONG", "SHORT", "SPOT"] as const).map((pos) => {
                  const selected = editForm.position === pos;
                  const selectedTone = pos === "LONG"
                    ? "border-up bg-up-soft text-up"
                    : pos === "SHORT"
                      ? "border-down bg-down-soft text-down"
                      : "border-accent bg-accent-soft text-accent";
                  return (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => setEditForm((f) => ({ ...f, position: pos }))}
                      className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                        selected ? selectedTone : "border-line bg-paper text-ink-2 hover:bg-wash"
                      }`}
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="label-caps">Notes</label>
              <textarea
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                className={`${INPUT} resize-none p-2 text-xs`}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={saveEdit}
                className="rounded-lg bg-ink px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-paper transition-colors hover:bg-[#23313f]"
              >
                Save Changes
              </button>
              <span className="text-[10px] text-ink-3">
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
      <label className="label-caps">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">{prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${INPUT} num p-2 text-xs ${prefix ? "pl-[1.4rem]" : ""} ${suffix ? "pr-[1.4rem]" : ""}`}
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">{suffix}</span>}
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
  const netTone = stats.netPnlUsd > 0 ? "text-up" : stats.netPnlUsd < 0 ? "text-down" : "text-ink";

  return (
    <div className="animate-fade-up flex flex-col gap-5 [animation-delay:100ms]! xl:col-span-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink">Trade Timeline</h2>
        {entries.length > 0 && (
          <button
            onClick={() => { if (window.confirm("Clear entire journal?")) clearJournal(); }}
            className="rounded-md px-2 py-1 text-xs font-bold text-down transition-colors hover:bg-down-soft"
          >
            Clear Log
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <div className="panel flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="label-caps">Performance</span>
              <span className="text-xs text-ink-3">
                {stats.closedCount} closed · {stats.openCount} open
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="label-caps">Net PnL</span>
              <span className={`num font-display text-lg font-bold ${netTone}`}>
                {fmtUsd(stats.netPnlUsd)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatTile label="Total Trades" value={String(stats.total)} sub={`${stats.closedCount} closed`} />
            <StatTile label="Win Rate" value={`${stats.winRate.toFixed(0)}%`} sub={`${stats.winsCount}W · ${stats.lossesCount}L`} tone={stats.winRate >= 50 ? "green" : stats.winRate > 0 ? "red" : "neutral"} />
            <StatTile label="Avg PnL" value={`${stats.avgPnlPercent >= 0 ? "+" : ""}${stats.avgPnlPercent.toFixed(2)}%`} sub="per closed trade" tone={stats.avgPnlPercent >= 0 ? "green" : "red"} />
            <StatTile label="Total Invested" value={`$${stats.totalInvested.toFixed(2)}`} sub={`Open: $${stats.openExposure.toFixed(2)}`} />
          </div>

          {stats.closedCount > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between rounded-lg bg-up-soft px-3 py-2.5">
                <span className="label-caps">Total Profit</span>
                <span className="num text-sm font-bold text-up">+${stats.totalProfitUsd.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-down-soft px-3 py-2.5">
                <span className="label-caps">Total Loss</span>
                <span className="num text-sm font-bold text-down">−${Math.abs(stats.totalLossUsd).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line-2 bg-paper p-12 text-center">
          <p className="text-sm text-ink-3">Your journal is empty. Log a trade or upload a screenshot.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <TimelineTabPill label="All" count={stats.total} active={tab === "all"} onClick={() => setTab("all")} />
            <TimelineTabPill label="Open" count={stats.openCount} active={tab === "open"} onClick={() => setTab("open")} tone="accent" />
            <TimelineTabPill label="Closed" count={stats.closedCount} active={tab === "closed"} onClick={() => setTab("closed")} tone="neutral" />
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-line-2 bg-paper p-8 text-center">
              <p className="text-sm text-ink-3">
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
  const valueColor = tone === "green" ? "text-up" : tone === "red" ? "text-down" : "text-ink";
  return (
    <div className="rounded-lg bg-wash px-3 py-3">
      <p className="label-caps mb-1">{label}</p>
      <p className={`num text-base font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink-3">{sub}</p>}
    </div>
  );
}

function TimelineTabPill({ label, count, active, onClick, tone }: { label: string; count: number; active: boolean; onClick: () => void; tone?: "accent" | "neutral" }) {
  const activeStyles = tone === "accent"
    ? "border-accent bg-accent-soft text-accent"
    : "border-ink bg-ink text-paper";

  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
        active ? activeStyles : "border-line bg-paper text-ink-2 hover:bg-wash"
      }`}
    >
      <span>{label}</span>
      <span className={`num rounded px-1.5 py-0.5 text-[10px] font-bold ${active ? (tone === "accent" ? "bg-paper" : "bg-paper/15") : "bg-wash"}`}>
        {count}
      </span>
    </button>
  );
}
