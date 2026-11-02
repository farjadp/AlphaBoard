import type { SourceScore } from "./resources";

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

/** Outcomes per source. Small samples are shown, but labelled as what they are. */
export function Scorecard({ scores }: { scores: SourceScore[] }) {
  return (
    <section aria-labelledby="score-h" className="space-y-3">
      <h2 id="score-h" className="font-display text-lg font-bold text-ink">Scorecard by source</h2>
      {scores.length === 0 ? (
        <p className="text-sm text-ink-3">No zone has an outcome yet. Each one is scored 24 hours after price reaches it, or at the end of its week.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="py-1 font-semibold">Source</th><th className="font-semibold">Zones scored</th><th className="font-semibold">Reached</th>
                <th className="font-semibold">Held</th><th className="font-semibold">Broke</th><th className="font-semibold">Unclear</th><th className="font-semibold">Targets hit</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => {
                const zones = s.touched + s.untouched;
                return (
                  <tr key={s.source} className="border-t border-line tabular-nums">
                    <td className="py-1.5 font-semibold text-ink" dir="auto">{s.source}</td>
                    <td>{s.zones}</td>
                    <td>{pct(s.touched, zones)} <span className="text-ink-3">({s.touched}/{zones})</span></td>
                    <td className="text-up">{pct(s.respected, s.touched)} <span className="text-ink-3">({s.respected})</span></td>
                    <td className="text-down">{pct(s.broke, s.touched)} <span className="text-ink-3">({s.broke})</span></td>
                    <td className="text-ink-2">{s.unclear}</td>
                    <td>{pct(s.targetsHit, s.targetsHit + s.targetsMissed)} <span className="text-ink-3">({s.targetsHit}/{s.targetsHit + s.targetsMissed})</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-3">
        Held = price moved away by at least the zone&apos;s width before a 1H close beyond its far edge; broke = that close came first.
        Fewer than 30 reached zones is not evidence of an edge either way.
      </p>
    </section>
  );
}
