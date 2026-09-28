"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Annotation } from "@/hooks/useChartAcademy";
import { compressImage } from "@/lib/client/image";

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
  // Same face as the UI (next/font gives Manrope a generated family name, so read it from the page).
  ctx.font = `bold 10px ${getComputedStyle(document.body).fontFamily || "system-ui, sans-serif"}`;
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
    <div ref={containerRef} className="relative w-full overflow-hidden rounded-[10px]">
      <canvas ref={canvasRef} className="block rounded-[10px]" />
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

  const handleFile = async (file: File) => {
    try {
      onFile(await compressImage(file));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not load the image");
    }
  };

  const borderClass = dragging ? "border-accent" : imageDataUrl ? "border-up" : "border-line-2";
  const bgClass = dragging ? "bg-wash" : "bg-paper hover:bg-wash";
  const sizeClass = imageDataUrl ? "p-0" : "min-h-[120px] px-4 py-6";

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      className={`relative flex cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors duration-200 ${borderClass} ${bgClass} ${sizeClass}`}
    >
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

      {imageDataUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview; next/image cannot optimise it */}
          <img src={imageDataUrl} alt={label} className="block w-full rounded-[10px]" />
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            aria-label="Remove image"
            className="absolute right-2 top-2 flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full bg-down text-[11px] text-paper hover:bg-down/85"
          >✕</button>
          <div className="absolute bottom-1.5 left-1.5 rounded-[5px] bg-ink/85 px-2 py-0.5 text-[10px] font-bold tracking-[0.06em] text-paper">{timeframe}</div>
        </>
      ) : (
        <div className="text-center">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="mx-auto mb-1.5 h-6 w-6 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M7 15l4-4 3 3 5-6" />
          </svg>
          <div className="mb-0.5 text-xs font-semibold text-ink-2">{label}</div>
          <div className="text-[10px] text-ink-3">Drop or click · {timeframe}</div>
        </div>
      )}
    </div>
  );
}

// ─── Signal Badge ─────────────────────────────────────────────────────────────

const SIGNAL_CLASSES: Record<"BUY" | "SELL" | "HOLD", string> = {
  BUY: "bg-up-soft border-up text-up",
  SELL: "bg-down-soft border-down text-down",
  HOLD: "bg-amber-soft border-amber text-amber",
};

const SIGNAL_SIZES: Record<"sm" | "md" | "lg", string> = {
  lg: "text-[15px] px-4 py-[7px]",
  md: "text-[11px] px-2.5 py-1",
  sm: "text-[9px] px-[7px] py-0.5",
};

export function SignalBadge({ signal, size = "md" }: { signal: "BUY" | "SELL" | "HOLD"; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`rounded-[7px] border font-extrabold tracking-[0.07em] ${SIGNAL_CLASSES[signal]} ${SIGNAL_SIZES[size]}`}>
      {signal}
    </span>
  );
}

// ─── Confluence Meter ─────────────────────────────────────────────────────────

export function ConfluenceMeter({ score }: { score: number }) {
  const tone = score >= 70 ? { text: "text-up", bg: "bg-up" } : score >= 45 ? { text: "text-amber", bg: "bg-amber" } : { text: "text-down", bg: "bg-down" };
  const label = score >= 70 ? "Strong Confluence" : score >= 45 ? "Moderate" : "Weak / Conflicting";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="label-caps">Multi-TF Confluence</span>
        <div className="flex items-baseline gap-1">
          <span className={`num text-[22px] font-extrabold ${tone.text}`}>{score}</span>
          <span className="text-[10px] text-ink-3">/100</span>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-wash">
        {/* width is computed from the score */}
        <div className={`h-full rounded transition-[width] duration-700 ease-out ${tone.bg}`} style={{ width: `${score}%` }} />
      </div>
      <div className={`text-[10px] font-semibold ${tone.text}`}>{label}</div>
    </div>
  );
}
