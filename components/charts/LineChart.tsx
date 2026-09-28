"use client";

import { useMemo, useState } from "react";
import { money, when } from "@/components/paper/format";

const W = 760, H = 220;
const PAD = { top: 14, right: 12, bottom: 24, left: 64 };

export type ChartUnit = "usdt" | "r";

const fmt = (unit: ChartUnit, v: number) => (unit === "usdt" ? money(v) : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}R`);

/**
 * One series over time: a 2px line, a dashed baseline reference (starting balance, or 0R), recessive
 * axes, crosshair + tooltip on hover/touch, and a visually hidden table for screen readers.
 * `unit` (not a formatter function) so server components can render it.
 */
export default function LineChart({ points, baseline, baselineLabel, unit, title, empty }: {
  points: Array<{ at: string; value: number }>;
  baseline: number;
  baselineLabel: string;
  unit: ChartUnit;
  title: string;
  empty: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const ts = points.map((p) => new Date(p.at).getTime());
    const values = [...points.map((p) => p.value), baseline];
    let lo = Math.min(...values), hi = Math.max(...values);
    const padV = (hi - lo) * 0.1 || Math.max(1, hi * 0.01);
    lo -= padV; hi += padV;
    const t0 = ts[0] ?? 0, t1 = ts.at(-1) ?? 1;
    const x = (t: number) => PAD.left + (t1 === t0 ? (W - PAD.left - PAD.right) / 2 : ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right));
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const xy = points.map((p, i) => [x(ts[i]), y(p.value)] as const);
    const line = xy.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
    const area = xy.length ? `${line}L${xy.at(-1)![0].toFixed(1)},${H - PAD.bottom}L${xy[0][0].toFixed(1)},${H - PAD.bottom}Z` : "";
    const ticks = [hi - padV, (hi + lo) / 2, lo + padV].map((v) => ({ v, y: y(v) }));
    return { xy, line, area, ticks, baseY: y(baseline), t0, t1 };
  }, [points, baseline]);

  if (points.length < 2) {
    return <p className="py-10 text-center text-sm text-ink-3">{empty}</p>;
  }

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    geo.xy.forEach(([x], i) => { if (Math.abs(x - px) < Math.abs(geo.xy[best][0] - px)) best = i; });
    setHover(best);
  }

  const h = hover == null ? null : { p: points[hover], x: geo.xy[hover][0], y: geo.xy[hover][1] };
  const tipW = 150, tipX = h ? Math.min(Math.max(h.x - tipW / 2, PAD.left), W - PAD.right - tipW) : 0;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none select-none" role="img"
        aria-label={`${title} from ${fmt(unit, points[0].value)} to ${fmt(unit, points.at(-1)!.value)}`}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`fill-${unit}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t.v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" className="fill-ink-3 text-[11px] tabular-nums">{fmt(unit, t.v)}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={geo.baseY} y2={geo.baseY} className="stroke-ink-3" strokeWidth={1} strokeDasharray="4 4" />
        <text x={W - PAD.right} y={geo.baseY - 5} textAnchor="end" className="fill-ink-3 text-[10px]">{baselineLabel}</text>
        <path d={geo.area} fill={`url(#fill-${unit})`} />
        <path d={geo.line} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <text x={PAD.left} y={H - 6} className="fill-ink-3 text-[10px]">{when(points[0].at)}</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-ink-3 text-[10px]">{when(points.at(-1)!.at)}</text>
        {h && (
          <g pointerEvents="none">
            <line x1={h.x} x2={h.x} y1={PAD.top} y2={H - PAD.bottom} className="stroke-line-2" strokeWidth={1} />
            <circle cx={h.x} cy={h.y} r={4} className="fill-accent stroke-paper" strokeWidth={2} />
            <rect x={tipX} y={PAD.top} width={tipW} height={40} rx={6} className="fill-paper stroke-line-2" />
            <text x={tipX + 10} y={PAD.top + 16} className="fill-ink-3 text-[10px]">{when(h.p.at)}</text>
            <text x={tipX + 10} y={PAD.top + 32} className="fill-ink text-[13px] font-semibold tabular-nums">{fmt(unit, h.p.value)}{unit === "usdt" ? " USDT" : ""}</text>
          </g>
        )}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Time</th><th>{title}</th></tr></thead>
        <tbody>{points.map((p, i) => <tr key={`${p.at}-${i}`}><td>{when(p.at)}</td><td>{fmt(unit, p.value)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
