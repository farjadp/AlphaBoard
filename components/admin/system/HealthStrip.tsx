type Run = { at: string; ms: number; errors: number };

const W = 720, H = 64, GAP = 2;

/**
 * One bar per scheduler run (≈ last 2 hours). Height = run time, colour = outcome; a red tick marks a
 * gap where runs were missed (> 90 s between runs). Hover a bar for its time; the table is for screen readers.
 */
export default function HealthStrip({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return <p className="py-6 text-sm text-ink-3">No runs recorded yet. The first one happens within a minute of the server starting.</p>;
  const n = 120;
  const bw = (W - GAP * (n - 1)) / n;
  const max = Math.max(...runs.map((r) => r.ms), 1000);
  const offset = n - runs.length; // right-align: newest run on the right edge
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="h-auto w-full" role="img" aria-label={`Last ${runs.length} scheduler runs; ${runs.filter((r) => r.errors).length} with errors`}>
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-line" strokeWidth={1} />
        {runs.map((r, i) => {
          const x = (offset + i) * (bw + GAP);
          const h = Math.max(6, (r.ms / max) * (H - 6));
          const gap = i > 0 && new Date(r.at).getTime() - new Date(runs[i - 1].at).getTime() > 90_000;
          return (
            <g key={r.at}>
              <title>{`${t(r.at)} · ${r.ms < 1000 ? `${r.ms} ms` : `${(r.ms / 1000).toFixed(1)} s`} · ${r.errors ? `${r.errors} error${r.errors === 1 ? "" : "s"}` : "ok"}${gap ? " · runs were missed before this one" : ""}`}</title>
              {gap && <rect x={x - GAP} y={0} width={1.5} height={H} className="fill-down" />}
              <rect x={x} y={H - h} width={bw} height={h} rx={1.5} className={r.errors ? "fill-amber" : "fill-up"} />
            </g>
          );
        })}
        <text x={0} y={H + 13} className="fill-ink-3 text-[10px]">≈ 2 h ago</text>
        <text x={W} y={H + 13} textAnchor="end" className="fill-ink-3 text-[10px]">now</text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-up" />Run OK (height = duration)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber" />Run with errors</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-0.5 bg-down" />Missed runs</span>
      </figcaption>
      <table className="sr-only">
        <caption>Scheduler runs</caption>
        <thead><tr><th>Time</th><th>Duration (s)</th><th>Errors</th></tr></thead>
        <tbody>{runs.map((r) => <tr key={r.at}><td>{t(r.at)}</td><td>{(r.ms / 1000).toFixed(1)}</td><td>{r.errors}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
