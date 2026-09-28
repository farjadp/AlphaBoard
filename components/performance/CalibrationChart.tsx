import type { PerformanceReport } from "@/lib/eval/metrics";

const W = 520, ROW = 34, LEFT = 64, RIGHT = 56, TOP = 22;

/**
 * Stated confidence vs realized win rate per confidence band. Bar = realized win rate; tick = the
 * average confidence the model stated. A well-calibrated model has the bar end near its tick.
 */
export default function CalibrationChart({ rows }: { rows: PerformanceReport["calibration"] }) {
  const H = TOP + rows.length * ROW + 8;
  const x = (pct: number) => LEFT + (pct / 100) * (W - LEFT - RIGHT);
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Calibration: stated confidence versus realized win rate by confidence band">
        {[0, 50, 100].map((p) => (
          <g key={p}>
            <line x1={x(p)} x2={x(p)} y1={TOP - 6} y2={H - 8} className="stroke-[var(--border)]" strokeWidth={1} />
            <text x={x(p)} y={TOP - 10} textAnchor="middle" className="fill-[var(--text-3)] text-[10px]">{p}%</text>
          </g>
        ))}
        {rows.map((c, i) => {
          const y = TOP + i * ROW;
          return (
            <g key={c.bucket}>
              <title>{`${c.bucket}: ${c.trades} trades · realized ${c.winRate == null ? "—" : `${c.winRate.toFixed(0)}%`} · stated ${c.avgConfidence == null ? "—" : `${c.avgConfidence.toFixed(0)}%`}`}</title>
              <text x={LEFT - 10} y={y + 16} textAnchor="end" className="fill-[var(--text-2)] text-[11px] tabular-nums">{c.bucket}</text>
              <rect x={x(0)} y={y + 6} width={x(100) - x(0)} height={14} rx={3} className="fill-[var(--surface-2)]" />
              {c.winRate != null && <rect x={x(0)} y={y + 6} width={Math.max(2, x(c.winRate) - x(0))} height={14} rx={3} className="fill-[var(--accent)]" />}
              {c.avgConfidence != null && <line x1={x(c.avgConfidence)} x2={x(c.avgConfidence)} y1={y + 2} y2={y + 24} className="stroke-[var(--text)]" strokeWidth={2} />}
              <text x={W - RIGHT + 8} y={y + 17} className="fill-[var(--text-3)] text-[10px] tabular-nums">{c.trades ? `n=${c.trades}` : "no data"}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-[11px] text-[var(--text-3)]">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-[var(--accent)]" />Realized win rate</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-[var(--text)]" />Average stated confidence</span>
      </figcaption>
      <table className="sr-only">
        <caption>Calibration</caption>
        <thead><tr><th>Confidence band</th><th>Trades</th><th>Realized win rate</th><th>Average stated confidence</th></tr></thead>
        <tbody>{rows.map((c) => <tr key={c.bucket}><td>{c.bucket}</td><td>{c.trades}</td><td>{c.winRate?.toFixed(0) ?? "—"}</td><td>{c.avgConfidence?.toFixed(0) ?? "—"}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
