"use client";

import { useState } from "react";
import NavBar from "@/components/NavBar";
import { AnnotatedCanvas, DropZone, SignalBadge, ConfluenceMeter } from "@/components/AcademyUI";
import { useChartAcademy, Timeframe, Annotation } from "@/hooks/useChartAcademy";
import { apiErrorMessage } from "@/lib/client/apiError";

// ─── Types ────────────────────────────────────────────────────────────────────

type TFSlot = { timeframe: Timeframe; imageDataUrl: string | null };

interface AnalysisResult {
  overallSignal: "BUY" | "SELL" | "HOLD";
  confluenceScore: number;
  summary: string;
  lesson: string;
  patterns: string[];
  tags: string[];
  mistakes: string[];
  strengths: string[];
  timeframes: Array<{
    timeframe: string;
    signal: "BUY" | "SELL" | "HOLD";
    bias: string;
    reasoning: string;
    candlestickPattern: { name: string; location: string; x: number; y: number; bullish: boolean } | null;
    chartPattern: { name: string; description: string } | null;
    keyLevels: Array<{ type: string; price: string; y_pct: number; description: string }>;
    entryPlan: { entry_y: number; sl_y: number; tp1_y: number; tp2_y?: number; rrr: string };
    annotations: Annotation[];
  }>;
}

const TF_OPTIONS: { timeframe: Timeframe; label: string }[] = [
  { timeframe: "15m", label: "15 Min" },
  { timeframe: "1H",  label: "1 Hour" },
  { timeframe: "4H",  label: "4 Hour" },
  { timeframe: "1D",  label: "Daily"  },
];

// Annotation colours the AI draws on the chart (see lib/ai/prompts/chartAcademy.ts); the legend
// swatches must match those exact values, so they stay as data-driven inline colours.
const ANNOTATION_LEGEND = [
  { color: "#34d399", label: "Support / Bullish OB / TP" },
  { color: "#f87171", label: "Resistance / Bearish OB / SL" },
  { color: "#a78bfa", label: "FVG Zone" },
  { color: "#60a5fa", label: "Entry" },
  { color: "#fbbf24", label: "Structure" },
  { color: "#e879f9", label: "BOS / ChoCH" },
  { color: "#fb923c", label: "Liquidity" },
];

function keyLevelClass(type: string): string {
  if (["Support", "OB", "TP"].includes(type)) return "text-up";
  if (["Resistance", "SL"].includes(type)) return "text-down";
  if (type === "Liquidity") return "text-amber";
  if (type === "BOS" || type === "ChoCH") return "text-ink";
  return "text-accent";
}

function scoreBarClass(score: number): string {
  return score >= 70 ? "bg-up" : score >= 45 ? "bg-amber" : "bg-down";
}

const SECTION_TITLE = "label-caps mb-2.5 text-[11px]";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AcademyPage() {
  const { lessons, addLesson, removeLesson, clearLessons } = useChartAcademy();

  const [slots, setSlots] = useState<TFSlot[]>([
    { timeframe: "4H", imageDataUrl: null },
    { timeframe: "1H", imageDataUrl: null },
    { timeframe: "15m", imageDataUrl: null },
  ]);

  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"analyze" | "lessons">("analyze");
  const [activeTF, setActiveTF] = useState(0);

  const filledSlots = slots.filter((s) => s.imageDataUrl !== null);

  const updateSlot = (idx: number, field: keyof TFSlot, value: string | null) => {
    setSlots((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
    setResult(null);
    setSavedId(null);
  };

  const handleAnalyze = async () => {
    if (filledSlots.length === 0) return;
    setAnalyzing(true);
    setError(null);
    setResult(null);
    setSavedId(null);

    try {
      const res = await fetch("/api/chart-academy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          charts: filledSlots.map((s) => ({
            timeframe: s.timeframe,
            imageDataUrl: s.imageDataUrl,
          })),
        }),
      });

      if (!res.ok) throw new Error(await apiErrorMessage(res, "Chart analysis failed"));
      const data: AnalysisResult = await res.json();
      setResult(data);
      setActiveTF(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!result || saving) return;
    setSaving(true);
    setError(null);
    try {
      const id = await addLesson({
      overallSignal: result.overallSignal,
      confluenceScore: result.confluenceScore,
      summary: result.summary,
      lesson: result.lesson,
      patterns: result.patterns,
      tags: result.tags,
      mistakes: result.mistakes,
      strengths: result.strengths,
      charts: result.timeframes.map((tf) => {
        const slot = slots.find((s) => s.timeframe === tf.timeframe);
        return {
          timeframe: tf.timeframe as Timeframe,
          imageDataUrl: slot?.imageDataUrl ?? "",
          annotations: tf.annotations,
          signal: tf.signal,
          bias: tf.bias,
        };
      }),
      });
      setSavedId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the lesson");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-page">
      <NavBar />

      <main className="flex-1 overflow-y-auto">
        {/* ── Header ── */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 pt-8">
          <div>
            <h1 className="m-0 font-display text-2xl font-extrabold text-ink">Chart Academy</h1>
            <p className="mt-1 text-xs text-ink-3">
              آپلود اسکرین‌شات چارت · AI تحلیل می‌کند · خطوط روی چارت رسم می‌شود · درس ذخیره می‌شود
            </p>
          </div>
          <div className="flex gap-2">
            {(["analyze", "lessons"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`cursor-pointer rounded-lg border px-[18px] py-[7px] text-xs font-semibold capitalize transition-colors ${
                  activeTab === tab
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-paper text-ink-3 hover:bg-wash hover:text-ink-2"
                }`}
              >
                {tab === "analyze" ? "Analyze" : `Lessons (${lessons.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* ── Analyze Tab ── */}
        {activeTab === "analyze" && (
          <div className={`mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-6 ${result ? "lg:grid-cols-[minmax(0,1fr)_400px]" : ""}`}>

            {/* Left: Upload + Charts */}
            <div className="flex flex-col gap-5">

              {/* Slot selectors + drop zones */}
              <div className="panel p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="m-0 text-sm font-bold text-ink">آپلود چارت‌ها</h2>
                  <span className="text-[11px] text-ink-3">تا ۳ تایم‌فریم</span>
                </div>

                <div className="grid grid-cols-3 gap-3.5">
                  {slots.map((slot, idx) => (
                    <div key={idx} className="flex flex-col gap-2">
                      {/* Timeframe selector */}
                      <select
                        aria-label={`Timeframe of chart ${idx + 1}`}
                        value={slot.timeframe}
                        onChange={(e) => updateSlot(idx, "timeframe", e.target.value)}
                        className="w-full cursor-pointer rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[11px] font-bold text-ink focus:border-accent focus:outline-none"
                      >
                        {TF_OPTIONS.map((o) => (
                          <option key={o.timeframe} value={o.timeframe}>{o.label}</option>
                        ))}
                      </select>

                      <DropZone
                        label={`Chart ${idx + 1}`}
                        timeframe={slot.timeframe}
                        imageDataUrl={slot.imageDataUrl}
                        onFile={(url) => updateSlot(idx, "imageDataUrl", url)}
                        onClear={() => updateSlot(idx, "imageDataUrl", null)}
                      />
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleAnalyze}
                  disabled={filledSlots.length === 0 || analyzing}
                  className={`mt-4 w-full rounded-lg bg-ink p-[13px] text-[13px] font-bold tracking-[0.05em] text-paper hover:bg-ink-hover ${
                    filledSlots.length === 0 ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                  }`}
                >
                  {analyzing ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-paper/30 border-t-paper" />
                      AI در حال تحلیل...
                    </span>
                  ) : "تحلیل با AI"}
                </button>

                {error && (
                  <div className="mt-3 rounded-lg border border-down bg-down-soft px-3.5 py-2.5 text-xs text-down">
                    ⚠ {error}
                  </div>
                )}
              </div>

              {/* Annotated charts (shown after analysis) */}
              {result && result.timeframes.length > 0 && (
                <div className="panel p-5">
                  <div className="mb-4 flex flex-wrap items-center gap-2.5">
                    <h2 className="m-0 text-sm font-bold text-ink">چارت تحلیل‌شده</h2>
                    <div className="flex gap-1.5">
                      {result.timeframes.map((tf, i) => (
                        <button
                          key={tf.timeframe}
                          onClick={() => setActiveTF(i)}
                          className={`cursor-pointer rounded-md border px-3 py-1 text-[11px] font-bold ${
                            activeTF === i
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-wash text-ink-3 hover:text-ink-2"
                          }`}
                        >{tf.timeframe}</button>
                      ))}
                    </div>
                    <SignalBadge signal={result.timeframes[activeTF]?.signal ?? "HOLD"} />
                  </div>

                  {(() => {
                    const tf = result.timeframes[activeTF];
                    const slot = slots.find((s) => s.timeframe === tf?.timeframe);
                    if (!tf || !slot?.imageDataUrl) return null;
                    return (
                      <AnnotatedCanvas
                        imageDataUrl={slot.imageDataUrl}
                        annotations={tf.annotations}
                      />
                    );
                  })()}

                  {result.timeframes[activeTF] && (
                    <>
                      {/* Reasoning */}
                      <div className="mt-3 rounded-lg bg-wash p-3">
                        <p className="m-0 text-xs leading-relaxed text-ink-2">
                          {result.timeframes[activeTF].reasoning}
                        </p>
                      </div>
                      {/* Color Legend */}
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {ANNOTATION_LEGEND.map((l) => (
                          <div key={l.label} className="flex items-center gap-[5px]">
                            {/* swatch colour matches the annotation colour drawn on the canvas */}
                            <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: l.color }} />
                            <span className="text-[9px] text-ink-3">{l.label}</span>
                          </div>
                        ))}
                      </div>
                      {/* Entry Plan */}
                      {result.timeframes[activeTF].entryPlan && (
                        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                          {[
                            { label: "Entry", val: `y=${result.timeframes[activeTF].entryPlan.entry_y.toFixed(0)}%`, tone: "text-accent" },
                            { label: "SL", val: `y=${result.timeframes[activeTF].entryPlan.sl_y.toFixed(0)}%`, tone: "text-down" },
                            { label: "TP1", val: `y=${result.timeframes[activeTF].entryPlan.tp1_y.toFixed(0)}%`, tone: "text-up" },
                            { label: "R:R", val: result.timeframes[activeTF].entryPlan.rrr, tone: "text-amber" },
                          ].map((item) => (
                            <div key={item.label} className="rounded-md bg-wash p-1.5 text-center">
                              <div className="mb-0.5 text-[9px] text-ink-3">{item.label}</div>
                              <div className={`num text-[11px] font-bold ${item.tone}`}>{item.val}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right: Analysis Panel */}
            {result && (
              <div className="flex flex-col gap-4">

                {/* Overall Signal */}
                <div className="panel p-5">
                  <div className="mb-3.5 flex items-center justify-between">
                    <SignalBadge signal={result.overallSignal} size="lg" />
                    {savedId ? (
                      <span className="text-[11px] font-semibold text-up">✓ ذخیره شد</span>
                    ) : (
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="cursor-pointer rounded-lg bg-ink px-4 py-[7px] text-[11px] font-bold text-paper hover:bg-ink-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >{saving ? "در حال ذخیره…" : "ذخیره در مغز"}</button>
                    )}
                  </div>
                  <ConfluenceMeter score={result.confluenceScore} />
                  <p className="mb-0 mt-3 text-xs leading-[1.7] text-ink-2">
                    {result.summary}
                  </p>
                </div>

                {/* Lesson */}
                <div className="panel p-5">
                  <div className="mb-2.5 text-xs font-bold uppercase tracking-[0.05em] text-accent">درس آموزشی</div>
                  <p className="m-0 text-[13px] leading-[1.8] text-ink">{result.lesson}</p>
                </div>

                {/* Candlestick + Chart Pattern */}
                {result.timeframes.some(tf => tf.candlestickPattern || tf.chartPattern) && (
                  <div className="panel p-4">
                    <h3 className={SECTION_TITLE}>Patterns Detected</h3>
                    {result.timeframes.map((tf) => (
                      <div key={tf.timeframe}>
                        {tf.candlestickPattern && (
                          <div className={`mb-1.5 flex items-start gap-2 rounded-lg p-2 ${tf.candlestickPattern.bullish ? "bg-up-soft" : "bg-down-soft"}`}>
                            <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tf.candlestickPattern.bullish ? "bg-up" : "bg-down"}`} />
                            <div>
                              <div className={`text-[11px] font-bold ${tf.candlestickPattern.bullish ? "text-up" : "text-down"}`}>
                                {tf.candlestickPattern.name} <span className="text-[9px] font-normal text-ink-3">({tf.timeframe})</span>
                              </div>
                              <div className="mt-0.5 text-[10px] text-ink-2">{tf.candlestickPattern.location}</div>
                            </div>
                          </div>
                        )}
                        {tf.chartPattern && (
                          <div className="mb-1.5 flex items-start gap-2 rounded-lg bg-accent-soft p-2">
                            <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-[2px] bg-accent" />
                            <div>
                              <div className="text-[11px] font-bold text-accent">
                                {tf.chartPattern.name} <span className="text-[9px] font-normal text-ink-3">({tf.timeframe})</span>
                              </div>
                              <div className="mt-0.5 text-[10px] text-ink-2">{tf.chartPattern.description}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Per-TF key levels */}
                <div className="panel p-5">
                  <h3 className={`${SECTION_TITLE} mb-3`}>سطوح کلیدی هر تایم‌فریم</h3>
                  <div className="flex flex-col gap-2.5">
                    {result.timeframes.map((tf) => (
                      <div key={tf.timeframe} className="rounded-lg bg-wash p-2.5">
                        <div className="mb-1.5 flex items-center gap-2">
                          <div className="rounded-[5px] bg-accent-soft px-[7px] py-0.5 text-[10px] font-extrabold text-accent">{tf.timeframe}</div>
                          <SignalBadge signal={tf.signal} size="sm" />
                          <span className="flex-1 text-[10px] text-ink-3">{tf.bias}</span>
                        </div>
                        <div className="flex flex-col gap-[3px]">
                          {tf.keyLevels.map((kl, i) => (
                            <div key={i} className="flex items-center gap-1.5 text-[10px]">
                              <span className={`min-w-[62px] font-bold ${keyLevelClass(kl.type)}`}>{kl.type}</span>
                              <span className="num min-w-[70px] text-ink-2">{kl.price}</span>
                              <span className="text-ink-3">{kl.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Patterns + Strengths/Mistakes */}
                <div className="panel p-5">
                  <h3 className={SECTION_TITLE}>الگوها</h3>
                  <div className="mb-3.5 flex flex-wrap gap-1.5">
                    {result.patterns.map((p) => (
                      <span key={p} className="rounded-full bg-accent-soft px-2.5 py-[3px] text-[10px] font-semibold text-accent">{p}</span>
                    ))}
                    {result.tags.map((t) => (
                      <span key={t} className="rounded-full border border-line bg-wash px-2.5 py-[3px] text-[10px] font-semibold text-ink-2">{t}</span>
                    ))}
                  </div>

                  {result.strengths.length > 0 && (
                    <>
                      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-up">✓ نقاط قوت</h3>
                      {result.strengths.map((s, i) => (
                        <div key={i} className="mb-1 border-l-2 border-up py-[3px] pl-2.5 text-[11px] text-ink-2">{s}</div>
                      ))}
                    </>
                  )}

                  {result.mistakes.length > 0 && (
                    <>
                      <h3 className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-[0.07em] text-down">⚠ اشتباهات رایج</h3>
                      {result.mistakes.map((m, i) => (
                        <div key={i} className="mb-1 border-l-2 border-down py-[3px] pl-2.5 text-[11px] text-ink-2">{m}</div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Lessons Tab ── */}
        {activeTab === "lessons" && (
          <div className="mx-auto max-w-6xl px-6 py-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="m-0 text-base font-bold text-ink">درس‌های ذخیره‌شده</h2>
              {lessons.length > 0 && (
                <button
                  onClick={() => { if (window.confirm("همه درس‌ها پاک شوند؟")) clearLessons(); }}
                  className="cursor-pointer text-[11px] font-semibold text-down hover:underline"
                >پاک کردن همه</button>
              )}
            </div>

            {lessons.length === 0 ? (
              <div className="rounded-[14px] border border-dashed border-line-2 bg-paper p-12 text-center">
                <p className="text-[13px] text-ink-3">هنوز درسی ذخیره نشده. چارت آپلود کن و تحلیل بگیر.</p>
                <button
                  onClick={() => setActiveTab("analyze")}
                  className="mt-4 cursor-pointer rounded-lg bg-ink px-6 py-2.5 text-xs font-bold text-paper hover:bg-ink-hover"
                >
                  شروع تحلیل
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {lessons.map((lesson) => (
                  <div key={lesson.id} className="panel p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <SignalBadge signal={lesson.overallSignal} />
                        <span className="text-[11px] text-ink-3">{new Date(lesson.createdAt).toLocaleDateString("fa-IR")}</span>
                        <div className="flex items-center gap-1.5">
                          <div className="h-1 w-[60px] overflow-hidden rounded-sm bg-wash">
                            {/* width is computed from the score */}
                            <div className={`h-full rounded-sm ${scoreBarClass(lesson.confluenceScore)}`} style={{ width: `${lesson.confluenceScore}%` }} />
                          </div>
                          <span className="num text-[10px] text-ink-3">{lesson.confluenceScore}/100</span>
                        </div>
                        {lesson.patterns.slice(0, 3).map((p) => (
                          <span key={p} className="rounded-full bg-accent-soft px-2 py-0.5 text-[9px] font-semibold text-accent">{p}</span>
                        ))}
                      </div>
                      <button
                        onClick={() => removeLesson(lesson.id)}
                        className="cursor-pointer rounded px-1.5 py-0.5 text-sm text-ink-3 hover:bg-down-soft hover:text-down"
                        title="حذف"
                        aria-label="حذف"
                      >✕</button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {lesson.charts.slice(0, 3).map((chart) => (
                        chart.imageDataUrl ? (
                          <div key={chart.timeframe} className="relative w-[120px] shrink-0">
                            <AnnotatedCanvas imageDataUrl={chart.imageDataUrl} annotations={chart.annotations} />
                            <div className="absolute bottom-1 left-1 rounded bg-ink/80 px-1.5 py-px text-[9px] font-bold text-paper">{chart.timeframe}</div>
                          </div>
                        ) : null
                      ))}
                      <div className="min-w-[200px] flex-1">
                        <div className="mb-1.5 text-[10px] font-bold uppercase text-accent">درس</div>
                        <p className="m-0 text-xs leading-[1.7] text-ink-2">{lesson.lesson}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
