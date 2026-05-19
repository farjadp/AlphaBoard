"use client";

import { useState } from "react";
import NavBar from "@/components/NavBar";
import { AnnotatedCanvas, DropZone, SignalBadge, ConfluenceMeter } from "@/components/AcademyUI";
import { useChartAcademy, Timeframe, Annotation } from "@/hooks/useChartAcademy";

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

      if (!res.ok) throw new Error(await res.text());
      const data: AnalysisResult = await res.json();
      setResult(data);
      setActiveTF(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = () => {
    if (!result) return;
    const id = addLesson({
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
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <NavBar />

      <main className="flex-1 overflow-y-auto">
        {/* ── Header ── */}
        <div style={{ background: "var(--bg-2)", borderBottom: "1px solid var(--border)", padding: "16px 24px" }}>
          <div style={{ maxWidth: "1400px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h1 style={{ fontSize: "22px", fontWeight: 800, margin: 0, background: "var(--gradient-accent)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                Chart Academy
              </h1>
              <p style={{ fontSize: "12px", color: "var(--text-3)", margin: "4px 0 0" }}>
                آپلود اسکرین‌شات چارت · AI تحلیل می‌کند · خطوط روی چارت رسم می‌شود · درس ذخیره می‌شود
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {(["analyze", "lessons"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "7px 18px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                    border: activeTab === tab ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: activeTab === tab ? "var(--accent-dim)" : "var(--surface)",
                    color: activeTab === tab ? "var(--accent)" : "var(--text-3)",
                    transition: "all 0.2s",
                    textTransform: "capitalize",
                  }}
                >
                  {tab === "analyze" ? "🔍 Analyze" : `📚 Lessons (${lessons.length})`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Analyze Tab ── */}
        {activeTab === "analyze" && (
          <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "24px", display: "grid", gridTemplateColumns: result ? "1fr 400px" : "1fr", gap: "24px" }}>

            {/* Left: Upload + Charts */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

              {/* Slot selectors + drop zones */}
              <div className="glass-card" style={{ padding: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text)", margin: 0 }}>آپلود چارت‌ها</h2>
                  <span style={{ fontSize: "11px", color: "var(--text-3)" }}>تا ۳ تایم‌فریم</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
                  {slots.map((slot, idx) => (
                    <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {/* Timeframe selector */}
                      <select
                        value={slot.timeframe}
                        onChange={(e) => updateSlot(idx, "timeframe", e.target.value)}
                        style={{
                          width: "100%", padding: "6px 10px", borderRadius: "8px", fontSize: "11px",
                          fontWeight: 700, border: "1px solid var(--border)", background: "var(--surface)",
                          color: "var(--accent)", cursor: "pointer", outline: "none",
                        }}
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
                  className="glow-btn"
                  style={{ width: "100%", marginTop: "16px", padding: "13px", fontSize: "13px", fontWeight: 700, letterSpacing: "0.05em", opacity: filledSlots.length === 0 ? 0.4 : 1, cursor: filledSlots.length === 0 ? "not-allowed" : "pointer" }}
                >
                  {analyzing ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                      <span style={{ display: "inline-block", width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                      AI در حال تحلیل...
                    </span>
                  ) : "🧠 تحلیل با AI"}
                </button>

                {error && (
                  <div style={{ marginTop: "12px", padding: "10px 14px", borderRadius: "8px", background: "var(--red-bg)", border: "1px solid var(--red)", color: "var(--red)", fontSize: "12px" }}>
                    ⚠ {error}
                  </div>
                )}
              </div>

              {/* Annotated charts (shown after analysis) */}
              {result && result.timeframes.length > 0 && (
                <div className="glass-card" style={{ padding: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
                    <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text)", margin: 0 }}>چارت تحلیل‌شده</h2>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {result.timeframes.map((tf, i) => (
                        <button
                          key={tf.timeframe}
                          onClick={() => setActiveTF(i)}
                          style={{
                            padding: "4px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: 700, cursor: "pointer",
                            border: activeTF === i ? "1px solid var(--accent)" : "1px solid var(--border)",
                            background: activeTF === i ? "var(--accent-dim)" : "var(--surface-2)",
                            color: activeTF === i ? "var(--accent)" : "var(--text-3)",
                          }}
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
                      <div style={{ marginTop: "12px", padding: "12px", borderRadius: "8px", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                        <p style={{ fontSize: "12px", color: "var(--text-2)", margin: 0, lineHeight: 1.6 }}>
                          {result.timeframes[activeTF].reasoning}
                        </p>
                      </div>
                      {/* Color Legend */}
                      <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {[
                          { color: "#34d399", label: "Support / Bullish OB / TP" },
                          { color: "#f87171", label: "Resistance / Bearish OB / SL" },
                          { color: "#a78bfa", label: "FVG Zone" },
                          { color: "#60a5fa", label: "Entry" },
                          { color: "#fbbf24", label: "Structure" },
                          { color: "#e879f9", label: "BOS / ChoCH" },
                          { color: "#fb923c", label: "Liquidity" },
                        ].map((l) => (
                          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                            <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                            <span style={{ fontSize: "9px", color: "var(--text-3)" }}>{l.label}</span>
                          </div>
                        ))}
                      </div>
                      {/* Entry Plan */}
                      {result.timeframes[activeTF].entryPlan && (
                        <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "6px" }}>
                          {[
                            { label: "Entry", val: `y=${result.timeframes[activeTF].entryPlan.entry_y.toFixed(0)}%`, color: "#60a5fa" },
                            { label: "SL", val: `y=${result.timeframes[activeTF].entryPlan.sl_y.toFixed(0)}%`, color: "#f87171" },
                            { label: "TP1", val: `y=${result.timeframes[activeTF].entryPlan.tp1_y.toFixed(0)}%`, color: "#34d399" },
                            { label: "R:R", val: result.timeframes[activeTF].entryPlan.rrr, color: "#fbbf24" },
                          ].map((item) => (
                            <div key={item.label} style={{ padding: "6px", borderRadius: "6px", background: "var(--surface)", border: `1px solid ${item.color}40`, textAlign: "center" }}>
                              <div style={{ fontSize: "9px", color: "var(--text-3)", marginBottom: "2px" }}>{item.label}</div>
                              <div style={{ fontSize: "11px", fontWeight: 700, color: item.color, fontFamily: "JetBrains Mono,monospace" }}>{item.val}</div>
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
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

                {/* Overall Signal */}
                <div className="glass-card" style={{ padding: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <SignalBadge signal={result.overallSignal} size="lg" />
                    {savedId ? (
                      <span style={{ fontSize: "11px", color: "var(--green)", fontWeight: 600 }}>✓ ذخیره شد</span>
                    ) : (
                      <button
                        onClick={handleSave}
                        style={{
                          padding: "7px 16px", borderRadius: "8px", fontSize: "11px", fontWeight: 700, cursor: "pointer",
                          background: "var(--gradient-accent)", color: "#fff", border: "none",
                        }}
                      >💾 ذخیره در مغز</button>
                    )}
                  </div>
                  <ConfluenceMeter score={result.confluenceScore} />
                  <p style={{ fontSize: "12px", color: "var(--text-2)", marginTop: "12px", lineHeight: 1.7, margin: "12px 0 0" }}>
                    {result.summary}
                  </p>
                </div>

                {/* Lesson */}
                <div className="glass-card" style={{ padding: "20px", borderColor: "rgba(167,139,250,0.25)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <span style={{ fontSize: "16px" }}>🎓</span>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.05em" }}>درس آموزشی</span>
                  </div>
                  <p style={{ fontSize: "13px", color: "var(--text)", lineHeight: 1.8, margin: 0 }}>{result.lesson}</p>
                </div>

                {/* Candlestick + Chart Pattern */}
                {result.timeframes.some(tf => tf.candlestickPattern || tf.chartPattern) && (
                  <div className="glass-card" style={{ padding: "16px" }}>
                    <h3 style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 10px" }}>🕯 Patterns Detected</h3>
                    {result.timeframes.map((tf) => (
                      <div key={tf.timeframe}>
                        {tf.candlestickPattern && (
                          <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", padding: "8px", borderRadius: "7px", background: tf.candlestickPattern.bullish ? "rgba(52,211,153,0.07)" : "rgba(248,113,113,0.07)", border: `1px solid ${tf.candlestickPattern.bullish ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`, marginBottom: "6px" }}>
                            <span style={{ fontSize: "16px" }}>{tf.candlestickPattern.bullish ? "🟢" : "🔴"}</span>
                            <div>
                              <div style={{ fontSize: "11px", fontWeight: 700, color: tf.candlestickPattern.bullish ? "var(--green)" : "var(--red)" }}>
                                {tf.candlestickPattern.name} <span style={{ fontWeight: 400, color: "var(--text-3)", fontSize: "9px" }}>({tf.timeframe})</span>
                              </div>
                              <div style={{ fontSize: "10px", color: "var(--text-3)", marginTop: "2px" }}>{tf.candlestickPattern.location}</div>
                            </div>
                          </div>
                        )}
                        {tf.chartPattern && (
                          <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", padding: "8px", borderRadius: "7px", background: "rgba(96,165,250,0.07)", border: "1px solid rgba(96,165,250,0.2)", marginBottom: "6px" }}>
                            <span style={{ fontSize: "16px" }}>📐</span>
                            <div>
                              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent)" }}>
                                {tf.chartPattern.name} <span style={{ fontWeight: 400, color: "var(--text-3)", fontSize: "9px" }}>({tf.timeframe})</span>
                              </div>
                              <div style={{ fontSize: "10px", color: "var(--text-3)", marginTop: "2px" }}>{tf.chartPattern.description}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Per-TF key levels */}
                <div className="glass-card" style={{ padding: "20px" }}>
                  <h3 style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 12px" }}>سطوح کلیدی هر تایم‌فریم</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {result.timeframes.map((tf) => (
                      <div key={tf.timeframe} style={{ padding: "10px", borderRadius: "8px", background: "var(--surface-2)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                          <div style={{ padding: "2px 7px", borderRadius: "5px", background: "var(--accent-dim)", color: "var(--accent)", fontSize: "10px", fontWeight: 800 }}>{tf.timeframe}</div>
                          <SignalBadge signal={tf.signal} size="sm" />
                          <span style={{ fontSize: "10px", color: "var(--text-3)", flex: 1 }}>{tf.bias}</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          {tf.keyLevels.map((kl, i) => {
                            const typeColor = ["Support","OB","TP"].includes(kl.type) ? "#34d399" : ["Resistance","SL"].includes(kl.type) ? "#f87171" : kl.type === "FVG" ? "#a78bfa" : kl.type === "BOS" || kl.type === "ChoCH" ? "#e879f9" : kl.type === "Liquidity" ? "#fb923c" : "#60a5fa";
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px" }}>
                                <span style={{ color: typeColor, fontWeight: 700, minWidth: "62px" }}>{kl.type}</span>
                                <span style={{ color: "var(--text-2)", fontFamily: "JetBrains Mono,monospace", minWidth: "70px" }}>{kl.price}</span>
                                <span style={{ color: "var(--text-3)" }}>{kl.description}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Patterns + Strengths/Mistakes */}
                <div className="glass-card" style={{ padding: "20px" }}>
                  <h3 style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 10px" }}>الگوها</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px" }}>
                    {result.patterns.map((p) => (
                      <span key={p} style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "10px", fontWeight: 600, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(96,165,250,0.2)" }}>{p}</span>
                    ))}
                    {result.tags.map((t) => (
                      <span key={t} style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "10px", fontWeight: 600, background: "var(--surface-2)", color: "var(--text-3)", border: "1px solid var(--border)" }}>{t}</span>
                    ))}
                  </div>

                  {result.strengths.length > 0 && (
                    <>
                      <h3 style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 6px" }}>✓ نقاط قوت</h3>
                      {result.strengths.map((s, i) => (
                        <div key={i} style={{ fontSize: "11px", color: "var(--text-2)", padding: "3px 0 3px 10px", borderLeft: "2px solid var(--green)", marginBottom: "4px" }}>{s}</div>
                      ))}
                    </>
                  )}

                  {result.mistakes.length > 0 && (
                    <>
                      <h3 style={{ fontSize: "11px", fontWeight: 700, color: "var(--red)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "12px 0 6px" }}>⚠ اشتباهات رایج</h3>
                      {result.mistakes.map((m, i) => (
                        <div key={i} style={{ fontSize: "11px", color: "var(--text-2)", padding: "3px 0 3px 10px", borderLeft: "2px solid var(--red)", marginBottom: "4px" }}>{m}</div>
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
          <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)", margin: 0 }}>📚 درس‌های ذخیره‌شده</h2>
              {lessons.length > 0 && (
                <button
                  onClick={() => { if (window.confirm("همه درس‌ها پاک شوند؟")) clearLessons(); }}
                  style={{ fontSize: "11px", color: "var(--red)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
                >پاک کردن همه</button>
              )}
            </div>

            {lessons.length === 0 ? (
              <div className="glass-card" style={{ padding: "48px", textAlign: "center", borderStyle: "dashed" }}>
                <span style={{ fontSize: "36px", display: "block", marginBottom: "12px", opacity: 0.4 }}>🎓</span>
                <p style={{ color: "var(--text-3)", fontSize: "13px" }}>هنوز درسی ذخیره نشده. چارت آپلود کن و تحلیل بگیر.</p>
                <button onClick={() => setActiveTab("analyze")} className="glow-btn" style={{ marginTop: "16px", padding: "10px 24px", fontSize: "12px", fontWeight: 700 }}>
                  🔍 شروع تحلیل
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {lessons.map((lesson) => (
                  <div key={lesson.id} className="glass-card" style={{ padding: "20px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <SignalBadge signal={lesson.overallSignal} />
                        <span style={{ fontSize: "11px", color: "var(--text-3)" }}>{new Date(lesson.createdAt).toLocaleDateString("fa-IR")}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <div style={{ width: "60px", height: "4px", borderRadius: "2px", background: "var(--surface-2)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${lesson.confluenceScore}%`, background: lesson.confluenceScore >= 70 ? "var(--green)" : lesson.confluenceScore >= 45 ? "var(--yellow)" : "var(--red)", borderRadius: "2px" }} />
                          </div>
                          <span style={{ fontSize: "10px", color: "var(--text-3)" }}>{lesson.confluenceScore}/100</span>
                        </div>
                        {lesson.patterns.slice(0, 3).map((p) => (
                          <span key={p} style={{ padding: "2px 8px", borderRadius: "12px", fontSize: "9px", fontWeight: 600, background: "var(--accent-dim)", color: "var(--accent)" }}>{p}</span>
                        ))}
                      </div>
                      <button onClick={() => removeLesson(lesson.id)} style={{ color: "var(--text-3)", background: "none", border: "none", cursor: "pointer", fontSize: "14px", padding: "2px 6px" }} title="حذف">✕</button>
                    </div>

                    <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {lesson.charts.slice(0, 3).map((chart) => (
                        chart.imageDataUrl ? (
                          <div key={chart.timeframe} style={{ width: "120px", position: "relative", flexShrink: 0 }}>
                            <AnnotatedCanvas imageDataUrl={chart.imageDataUrl} annotations={chart.annotations} />
                            <div style={{ position: "absolute", bottom: 4, left: 4, fontSize: "9px", fontWeight: 700, color: "var(--accent)", background: "rgba(12,16,24,0.8)", padding: "1px 6px", borderRadius: "4px" }}>{chart.timeframe}</div>
                          </div>
                        ) : null
                      ))}
                      <div style={{ flex: 1, minWidth: "200px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                          <span style={{ fontSize: "14px" }}>🎓</span>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: "#a78bfa", textTransform: "uppercase" }}>درس</span>
                        </div>
                        <p style={{ fontSize: "12px", color: "var(--text-2)", lineHeight: 1.7, margin: 0 }}>{lesson.lesson}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
