"use client";

import { useRef, useState } from "react";
import { JournalEntry, PostMortemAnalysis } from "@/hooks/useJournal";
import { useTradeLessons } from "@/hooks/useTradeLessons";

interface Props {
  entry: JournalEntry;
  onUpdate: (id: string, updates: Partial<JournalEntry>) => void;
}

export default function TradePostMortem({ entry, onUpdate }: Props) {
  const { addLesson } = useTradeLessons();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(entry.screenshotUrl || null);
  const fileRef = useRef<HTMLInputElement>(null);

  const existing = entry.postMortem;
  const isClosed = entry.status === "CLOSED";

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/post-mortem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: entry.symbol,
          position: entry.position,
          entryPrice: entry.entryPrice,
          exitPrice: entry.exitPrice,
          pnlPercent: entry.pnlPercent,
          emotion: entry.emotion,
          leverage: entry.leverage,
          margin: entry.margin,
          marginMode: entry.marginMode,
          notes: entry.notes,
          context,
          status: entry.status,
          image: imagePreview || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to analyze trade");
      const data = await res.json();
      const postMortem: PostMortemAnalysis = {
        outcome: data.outcome,
        rootCause: data.rootCause,
        mistakes: data.mistakes ?? [],
        strengths: data.strengths ?? [],
        lesson: data.lesson,
        tags: data.tags ?? [],
        generatedAt: new Date().toISOString(),
      };
      onUpdate(entry.id, { postMortem, screenshotUrl: imagePreview || undefined });
      addLesson({
        tradeId: entry.id,
        symbol: entry.symbol,
        position: entry.position,
        outcome: postMortem.outcome,
        pnlPercent: entry.pnlPercent,
        rootCause: postMortem.rootCause,
        mistakes: postMortem.mistakes,
        strengths: postMortem.strengths,
        lesson: postMortem.lesson,
        tags: postMortem.tags,
        emotion: entry.emotion,
      });
      setOpen(false); // Close form automatically after analysis
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  if (existing && !open) {
    return (
      <div className="mt-3 rounded-xl p-3 flex flex-col gap-2 transition-all duration-200" style={{ background: "linear-gradient(135deg, rgba(82,170,255,0.06), rgba(168,85,247,0.04))", border: "1px solid var(--border-strong)" }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
              AI Post-Mortem
            </span>
            <OutcomeBadge outcome={existing.outcome} />
          </div>
          <button
            onClick={() => setOpen(true)}
            className="text-[10px] font-semibold px-2 py-1 rounded-md transition-all duration-200 hover:scale-105"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-2)" }}
          >
            Re-analyze
          </button>
        </div>
        <p className="text-xs leading-5" style={{ color: "var(--text)" }}>
          <span className="font-semibold">Why:</span> {existing.rootCause}
        </p>
        <p className="text-xs leading-5" style={{ color: "var(--text-2)" }}>
          <span className="font-semibold" style={{ color: "var(--accent)" }}>Lesson:</span> {existing.lesson}
        </p>
        {existing.mistakes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {existing.mistakes.map((m, i) => (
              <span key={`m-${i}`} className="text-[10px] px-2 py-0.5 rounded" style={{ background: "var(--red-bg)", color: "var(--red)" }}>− {m}</span>
            ))}
          </div>
        )}
        {existing.strengths.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {existing.strengths.map((s, i) => (
              <span key={`s-${i}`} className="text-[10px] px-2 py-0.5 rounded" style={{ background: "var(--green-bg)", color: "var(--green)" }}>+ {s}</span>
            ))}
          </div>
        )}
        {existing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {existing.tags.map((t, i) => (
              <span key={`t-${i}`} className="text-[10px] px-2 py-0.5 rounded font-mono" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text-3)" }}>#{t}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full py-2 px-3 rounded-lg text-[11px] font-semibold transition-all duration-200 hover:scale-[1.01] active:scale-95 flex items-center justify-center gap-2"
        style={{ background: "linear-gradient(135deg, rgba(82,170,255,0.1), rgba(168,85,247,0.08))", border: "1px solid var(--border-strong)", color: "var(--accent)" }}
      >
        <span>🔍</span>
        <span>{isClosed ? "Why did this happen? · AI Post-Mortem" : "Reflect on this open trade"}</span>
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl p-3 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-strong)" }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>AI Post-Mortem</span>
        <button onClick={() => setOpen(false)} className="text-[11px]" style={{ color: "var(--text-3)" }}>Cancel</button>
      </div>

      <div className="relative group">
        <div
          className="rounded-lg border-dashed border-2 p-3 cursor-pointer flex flex-col items-center justify-center gap-1 transition-all hover:bg-white/5"
          style={{ borderColor: "var(--border)" }}
          onClick={() => !imagePreview && fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagePreview} alt="preview" className="max-h-40 rounded-md" />
          ) : (
            <>
              <span className="text-lg">📸</span>
              <span className="text-[11px] font-semibold" style={{ color: "var(--text-2)" }}>Upload PnL / chart screenshot</span>
              <span className="text-[10px]" style={{ color: "var(--text-3)" }}>Optional · helps the AI see what really happened</span>
            </>
          )}
        </div>
        {imagePreview && (
          <button 
            onClick={() => setImagePreview(null)}
            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
          >
            ✕
          </button>
        )}
      </div>

      <textarea
        rows={3}
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="Optional context: market conditions, why you entered, what surprised you..."
        className="w-full bg-transparent p-2 rounded-lg text-xs resize-none border focus:outline-none"
        style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
      />

      {error && (
        <div className="text-[11px] p-2 rounded" style={{ background: "var(--red-bg)", color: "var(--red)" }}>{error}</div>
      )}

      <button
        onClick={runAnalysis}
        disabled={loading}
        className="glow-btn py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:scale-[1.01] active:scale-95"
      >
        {loading ? "Analyzing…" : existing ? "Re-run Analysis" : "Analyze Trade"}
      </button>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: PostMortemAnalysis["outcome"] }) {
  const styles = outcome === "WIN"
    ? { background: "var(--green-bg)", color: "var(--green)" }
    : outcome === "LOSS"
      ? { background: "var(--red-bg)", color: "var(--red)" }
      : outcome === "BREAKEVEN"
        ? { background: "var(--surface-2)", color: "var(--text-2)" }
        : { background: "var(--accent-dim)", color: "var(--accent)" };
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider" style={styles}>{outcome}</span>
  );
}
