"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Annotation } from "@/hooks/useChartAcademy";

// ─── helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length < 3) return null;
  return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
}

function rgba(hex: string, a: number) {
  const c = hexToRgb(hex);
  return c ? `rgba(${c.r},${c.g},${c.b},${a})` : hex;
}

function drawLabelPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  align: "left" | "right" | "center" = "left"
) {
  ctx.font = "bold 10px Inter,system-ui,sans-serif";
  const w = ctx.measureText(text).width + 10;
  const h = 16;
  let lx = x;
  if (align === "right") lx = x - w;
  if (align === "center") lx = x - w / 2;
  ctx.fillStyle = rgba(color, 0.88);
  roundRect(ctx, lx, y - h + 3, w, h, 3);
  ctx.fill();
  ctx.fillStyle = "#0a0f1a";
  ctx.fillText(text, lx + 5, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, up: boolean, color: string, size = 10) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size * 0.6, y + size * 0.2);
    ctx.lineTo(x + size * 0.6, y + size * 0.2);
  } else {
    ctx.moveTo(x, y + size);
    ctx.lineTo(x - size * 0.6, y - size * 0.2);
    ctx.lineTo(x + size * 0.6, y - size * 0.2);
  }
  ctx.closePath();
  ctx.fill();
  // glow ring
  ctx.strokeStyle = rgba(color, 0.3);
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.stroke();
}

// ─── Main drawing engine ───────────────────────────────────────────────────────

function drawAnnotations(ctx: CanvasRenderingContext2D, annotations: Annotation[], cw: number, ch: number) {
  const px = (v: number) => (v / 100) * cw;
  const py = (v: number) => (v / 100) * ch;

  // Sort: low priority first so high priority renders on top
  const sorted = [...annotations].sort((a, b) => {
    const order = { low: 0, medium: 1, high: 2 };
    return (order[a.priority ?? "low"] ?? 0) - (order[b.priority ?? "low"] ?? 0);
  });

  for (const ann of sorted) {
    ctx.save();
    ctx.strokeStyle = ann.color;
    ctx.fillStyle = ann.color;
    const lw = ann.thickness ?? (ann.priority === "high" ? 2 : 1.5);
    ctx.lineWidth = lw;
    ctx.setLineDash(ann.dashed ? [6, 4] : []);

    switch (ann.type) {

      // ── Horizontal line ──────────────────────────────────────────────────
      case "hline": {
        if (ann.y == null) break;
        const y = py(ann.y);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cw, y);
        ctx.stroke();

        // right-side label pill
        if (ann.label) {
          ctx.setLineDash([]);
          drawLabelPill(ctx, ann.label, cw - 6, y - 2, ann.color, "right");
        }
        break;
      }

      // ── Diagonal trend line ──────────────────────────────────────────────
      case "line": {
        if (ann.x1 == null || ann.y1 == null || ann.x2 == null || ann.y2 == null) break;
        const lx1 = px(ann.x1), ly1 = py(ann.y1), lx2 = px(ann.x2), ly2 = py(ann.y2);
        ctx.beginPath();
        ctx.moveTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.stroke();
        if (ann.label) {
          ctx.setLineDash([]);
          drawLabelPill(ctx, ann.label, lx2, ly2 - 6, ann.color, "right");
        }
        break;
      }

      // ── Zone / Rectangle ─────────────────────────────────────────────────
      case "zone": {
        if (ann.zx == null || ann.zy == null || ann.zw == null || ann.zh == null) break;
        const rx = px(ann.zx), ry = py(ann.zy);
        const rw = px(ann.zw), rh = py(ann.zh);
        const fo = ann.fillOpacity ?? 0.15;
        ctx.fillStyle = rgba(ann.color, fo);
        ctx.fillRect(rx, ry, rw, rh);
        // top border line (stronger)
        ctx.setLineDash([]);
        ctx.strokeStyle = rgba(ann.color, 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + rw, ry);
        ctx.stroke();
        // bottom border (lighter)
        ctx.strokeStyle = rgba(ann.color, 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rx, ry + rh);
        ctx.lineTo(rx + rw, ry + rh);
        ctx.stroke();
        // label at top-right of zone
        if (ann.label) {
          ctx.setLineDash([]);
          drawLabelPill(ctx, ann.label, rx + rw - 6, ry + 14, ann.color, "right");
        }
        break;
      }

      // ── Upward arrow (bullish candlestick / signal) ──────────────────────
      case "arrow_up": {
        if (ann.mx == null || ann.my == null) break;
        const ax = px(ann.mx), ay = py(ann.my);
        // stem
        ctx.strokeStyle = rgba(ann.color, 0.8);
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ax, ay + 18);
        ctx.lineTo(ax, ay + 4);
        ctx.stroke();
        drawArrowHead(ctx, ax, ay, true, ann.color, 9);
        if (ann.label) {
          ctx.setLineDash([]);
          drawLabelPill(ctx, ann.label, ax, ay - 12, ann.color, "center");
        }
        break;
      }

      // ── Downward arrow (bearish candlestick / signal) ────────────────────
      case "arrow_down": {
        if (ann.mx == null || ann.my == null) break;
        const ax = px(ann.mx), ay = py(ann.my);
        ctx.strokeStyle = rgba(ann.color, 0.8);
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ax, ay - 18);
        ctx.lineTo(ax, ay - 4);
        ctx.stroke();
        drawArrowHead(ctx, ax, ay, false, ann.color, 9);
        if (ann.label) {
          ctx.setLineDash([]);
          drawLabelPill(ctx, ann.label, ax, ay + 26, ann.color, "center");
        }
        break;
      }

      // ── Candlestick pattern marker (circle + label) ──────────────────────
      case "marker": {
        if (ann.mx == null || ann.my == null) break;
        const mx = px(ann.mx), my = py(ann.my);
        // pulsing ring
        ctx.strokeStyle = rgba(ann.color, 0.6);
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(mx, my, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = rgba(ann.color, 0.15);
        ctx.beginPath();
        ctx.arc(mx, my, 14, 0, Math.PI * 2);
        ctx.fill();
        if (ann.label) {
          ctx.setLineDash([]);
          drawLabelPill(ctx, ann.label, mx, my - 20, ann.color, "center");
        }
        break;
      }

      // ── Parallel channel ──────────────────────────────────────────────────
      case "channel": {
        if (ann.x1 == null || ann.x2 == null || ann.cy1a == null || ann.cy1b == null || ann.cy2a == null || ann.cy2b == null) break;
        const lx1 = px(ann.x1), lx2 = px(ann.x2);
        ctx.strokeStyle = rgba(ann.color, 0.8);
        ctx.lineWidth = 1.5;
        // upper line
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(lx1, py(ann.cy1a));
        ctx.lineTo(lx2, py(ann.cy2a));
        ctx.stroke();
        // lower line
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(lx1, py(ann.cy1b));
        ctx.lineTo(lx2, py(ann.cy2b));
        ctx.stroke();
        // fill
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(ann.color, 0.04);
        ctx.beginPath();
        ctx.moveTo(lx1, py(ann.cy1a));
        ctx.lineTo(lx2, py(ann.cy2a));
        ctx.lineTo(lx2, py(ann.cy2b));
        ctx.lineTo(lx1, py(ann.cy1b));
        ctx.closePath();
        ctx.fill();
        if (ann.label) drawLabelPill(ctx, ann.label, lx2 - 4, py(ann.cy2a) - 4, ann.color, "right");
        break;
      }

      // ── Fibonacci levels ─────────────────────────────────────────────────
      case "fib": {
        if (ann.y1 == null || ann.y2 == null) break;
        const fibs = [
          { r: 0, y: ann.y1, color: "#94a3b8" },
          { r: 0.236, y: ann.y1 + (ann.y2 - ann.y1) * 0.236, color: "#60a5fa" },
          { r: 0.382, y: ann.y1 + (ann.y2 - ann.y1) * 0.382, color: "#34d399" },
          { r: 0.5,   y: ann.y1 + (ann.y2 - ann.y1) * 0.5,   color: "#fbbf24" },
          { r: 0.618, y: ann.y1 + (ann.y2 - ann.y1) * 0.618, color: "#f87171" },
          { r: 0.786, y: ann.y1 + (ann.y2 - ann.y1) * 0.786, color: "#e879f9" },
          { r: 1,     y: ann.y2, color: "#94a3b8" },
        ];
        for (const f of fibs) {
          const fy = py(f.y);
          ctx.strokeStyle = rgba(f.color, 0.6);
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(0, fy);
          ctx.lineTo(cw, fy);
          ctx.stroke();
          ctx.setLineDash([]);
          drawLabelPill(ctx, `Fib ${f.r}`, 6, fy - 2, f.color, "left");
        }
        break;
      }

      // ── Floating text label ──────────────────────────────────────────────
      case "label": {
        const lx = ann.mx != null ? px(ann.mx) : ann.x1 != null ? px(ann.x1) : px(50);
        const ly = ann.my != null ? py(ann.my) : ann.y1 != null ? py(ann.y1) : py(50);
        if (ann.label) {
          ctx.setLineDash([]);
          drawLabelPill(ctx, ann.label, lx, ly, ann.color, "center");
        }
        break;
      }
    }

    ctx.restore();
  }
}

// ─── AnnotatedCanvas component ────────────────────────────────────────────────

interface AnnotatedCanvasProps {
  imageDataUrl: string;
  annotations: Annotation[];
}

export function AnnotatedCanvas({ imageDataUrl, annotations }: AnnotatedCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      const cw = container.clientWidth * (window.devicePixelRatio || 1);
      const ch = img.naturalHeight * (cw / img.naturalWidth);

      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${ch / (window.devicePixelRatio || 1)}px`;

      ctx.drawImage(img, 0, 0, cw, ch);
      drawAnnotations(ctx, annotations, cw, ch);
    };
    img.src = imageDataUrl;
  }, [imageDataUrl, annotations]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div ref={containerRef} style={{ width: "100%", position: "relative", borderRadius: "10px", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "block", borderRadius: "10px" }} />
    </div>
  );
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

interface DropZoneProps {
  label: string;
  timeframe: string;
  imageDataUrl: string | null;
  onFile: (dataUrl: string) => void;
  onClear: () => void;
}

export function DropZone({ label, timeframe, imageDataUrl, onFile, onClear }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onloadend = () => onFile(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      style={{
        border: `2px dashed ${dragging ? "var(--accent)" : imageDataUrl ? "var(--green)" : "var(--border-strong)"}`,
        borderRadius: "12px",
        padding: imageDataUrl ? "0" : "24px 16px",
        cursor: "pointer",
        background: dragging ? "var(--surface-hover)" : "var(--surface)",
        transition: "all 0.2s ease",
        position: "relative",
        overflow: "hidden",
        minHeight: imageDataUrl ? "auto" : "120px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

      {imageDataUrl ? (
        <>
          <img src={imageDataUrl} alt={label} style={{ width: "100%", display: "block", borderRadius: "10px" }} />
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} style={{ position: "absolute", top: 8, right: 8, width: 22, height: 22, borderRadius: "50%", background: "rgba(248,113,113,0.9)", border: "none", color: "#fff", fontSize: "11px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          <div style={{ position: "absolute", bottom: 6, left: 6, padding: "2px 8px", borderRadius: "5px", background: "rgba(12,16,24,0.88)", fontSize: "10px", fontWeight: 700, color: "var(--accent)", letterSpacing: "0.06em" }}>{timeframe}</div>
        </>
      ) : (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "26px", marginBottom: "6px", opacity: 0.45 }}>📈</div>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-2)", marginBottom: "2px" }}>{label}</div>
          <div style={{ fontSize: "10px", color: "var(--text-3)" }}>Drop or click · {timeframe}</div>
        </div>
      )}
    </div>
  );
}

// ─── Signal Badge ─────────────────────────────────────────────────────────────

export function SignalBadge({ signal, size = "md" }: { signal: "BUY" | "SELL" | "HOLD"; size?: "sm" | "md" | "lg" }) {
  const c = { BUY: { bg: "var(--green-bg)", br: "var(--green)", tx: "var(--green)" }, SELL: { bg: "var(--red-bg)", br: "var(--red)", tx: "var(--red)" }, HOLD: { bg: "var(--yellow-bg)", br: "var(--yellow)", tx: "var(--yellow)" } }[signal];
  const fs = size === "lg" ? "15px" : size === "md" ? "11px" : "9px";
  const p = size === "lg" ? "7px 16px" : size === "md" ? "4px 10px" : "2px 7px";
  return <span style={{ background: c.bg, border: `1px solid ${c.br}`, color: c.tx, fontWeight: 800, fontSize: fs, padding: p, borderRadius: "7px", letterSpacing: "0.07em" }}>{signal}</span>;
}

// ─── Confluence Meter ─────────────────────────────────────────────────────────

export function ConfluenceMeter({ score }: { score: number }) {
  const color = score >= 70 ? "var(--green)" : score >= 45 ? "var(--yellow)" : "var(--red)";
  const label = score >= 70 ? "Strong Confluence" : score >= 45 ? "Moderate" : "Weak / Conflicting";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "10px", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Multi-TF Confluence</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
          <span style={{ fontSize: "22px", fontWeight: 800, color, fontFamily: "JetBrains Mono,monospace" }}>{score}</span>
          <span style={{ fontSize: "10px", color: "var(--text-3)" }}>/100</span>
        </div>
      </div>
      <div style={{ height: "6px", borderRadius: "4px", background: "var(--surface-2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${score}%`, borderRadius: "4px", background: color, boxShadow: `0 0 10px ${color}`, transition: "width 0.7s ease" }} />
      </div>
      <div style={{ fontSize: "10px", color, fontWeight: 600 }}>{label}</div>
    </div>
  );
}
