"use client";

import { useRef, useState } from "react";
import { JournalEntry, PostMortemAnalysis } from "@/hooks/useJournal";
import { useTradeLessons } from "@/hooks/useTradeLessons";
import { compressImage } from "@/lib/client/image";
import { apiErrorMessage } from "@/lib/client/apiError";

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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImagePreview(await compressImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the image");
    } finally {
      e.target.value = "";
    }
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
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Failed to analyze the trade"));
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
      <div className="mt-3 flex flex-col gap-2 rounded-lg bg-wash p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
              AI Post-Mortem
            </span>
            <OutcomeBadge outcome={existing.outcome} />
          </div>
          <button
            onClick={() => setOpen(true)}
            className="rounded-md border border-line-2 bg-paper px-2 py-1 text-[10px] font-bold text-ink-2 transition-colors hover:bg-wash hover:text-ink"
          >
            Re-analyze
          </button>
        </div>
        <p className="text-xs leading-5 text-ink">
          <span className="font-semibold">Why:</span> {existing.rootCause}
        </p>
        <p className="text-xs leading-5 text-ink-2">
          <span className="font-semibold text-accent">Lesson:</span> {existing.lesson}
        </p>
        {existing.mistakes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {existing.mistakes.map((m, i) => (
              <span key={`m-${i}`} className="rounded bg-down-soft px-2 py-0.5 text-[10px] text-down">− {m}</span>
            ))}
          </div>
        )}
        {existing.strengths.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {existing.strengths.map((s, i) => (
              <span key={`s-${i}`} className="rounded bg-up-soft px-2 py-0.5 text-[10px] text-up">+ {s}</span>
            ))}
          </div>
        )}
        {existing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {existing.tags.map((t, i) => (
              <span key={`t-${i}`} className="rounded border border-line bg-paper px-2 py-0.5 font-mono text-[10px] text-ink-3">#{t}</span>
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
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-line-2 px-3 py-2 text-[11px] font-bold text-ink transition-colors hover:bg-wash"
      >
        <span>{isClosed ? "Why did this happen? · AI Post-Mortem" : "Reflect on this open trade"}</span>
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg bg-wash p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-ink">AI Post-Mortem</span>
        <button onClick={() => setOpen(false)} className="text-[11px] font-semibold text-ink-3 hover:text-ink">Cancel</button>
      </div>

      <div className="group relative">
        <div
          className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line-2 bg-paper p-3 transition-colors hover:border-accent"
          onClick={() => !imagePreview && fileRef.current?.click()}
          role="button" tabIndex={imagePreview ? -1 : 0} aria-label="Attach a chart screenshot for the post-mortem"
          onKeyDown={(e) => { if (!imagePreview && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fileRef.current?.click(); } }}
        >
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagePreview} alt="Chart screenshot attached to this post-mortem" className="max-h-40 rounded-md" />
          ) : (
            <>
              <span className="text-[11px] font-semibold text-ink-2">Upload PnL / chart screenshot</span>
              <span className="text-[10px] text-ink-3">Optional · helps the AI see what really happened</span>
            </>
          )}
        </div>
        {imagePreview && (
          <button
            onClick={() => setImagePreview(null)}
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-down text-xs text-paper opacity-0 transition-opacity group-hover:opacity-100"
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
        className="w-full resize-none rounded-lg border border-line bg-paper p-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />

      {error && (
        <div className="rounded bg-down-soft p-2 text-[11px] text-down">{error}</div>
      )}

      <button
        onClick={runAnalysis}
        disabled={loading}
        className="rounded-lg bg-ink py-2 text-[11px] font-bold uppercase tracking-wider text-paper transition-colors hover:bg-ink-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Analyzing…" : existing ? "Re-run Analysis" : "Analyze Trade"}
      </button>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: PostMortemAnalysis["outcome"] }) {
  const tone = outcome === "WIN"
    ? "bg-up-soft text-up"
    : outcome === "LOSS"
      ? "bg-down-soft text-down"
      : outcome === "BREAKEVEN"
        ? "bg-paper text-ink-2 border border-line"
        : "bg-accent-soft text-accent";
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>{outcome}</span>
  );
}
