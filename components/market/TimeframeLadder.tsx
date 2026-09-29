import type { ConsensusScore } from "@/lib/market/indicators";
import type { TimeframeSummary } from "@/lib/market/report";

interface TimeframeLadderProps {
  frames?: TimeframeSummary[];
  consensus?: ConsensusScore;
  current: string;
}

const ARROW = { Bullish: "▲", Bearish: "▼", Neutral: "■" } as const;
const TONE = { Bullish: "text-up", Bearish: "text-down", Neutral: "text-ink-3" } as const;

/** One row: trend direction and RSI on every timeframe, highest first. */
export default function TimeframeLadder({ frames, consensus, current }: TimeframeLadderProps) {
  if (!frames) {
    return <div className="panel skeleton h-[88px]" aria-label="Loading timeframes" />;
  }
  const available = frames.filter((f) => f.available);
  const upCount = available.filter((f) => f.trendSignal === "Bullish").length;
  const downCount = available.filter((f) => f.trendSignal === "Bearish").length;

  return (
    <section aria-label="Timeframe agreement" tabIndex={0} className="panel overflow-x-auto">
      <div className="grid min-w-[760px] grid-cols-[200px_repeat(auto-fit,minmax(90px,1fr))]">
      <div className="flex flex-col justify-center gap-1 border-r border-line px-5 py-4">
        <span className="label-caps">Timeframe agreement</span>
        <b className="whitespace-nowrap font-display text-[21px] leading-none">{upCount} up · {downCount} down</b>
        {consensus && (
          <span className="text-[12px] text-ink-3">
            Consensus <span className="num text-ink-2">{consensus.netScore}/100</span> · {consensus.confluenceStrength === "Conflicting" ? "higher and lower frames disagree" : `${consensus.confluenceStrength.toLowerCase()} confluence`}
          </span>
        )}
      </div>
      {frames.map((f) => (
        <div key={f.timeframe} className={`flex flex-col gap-2 border-r border-line px-4 py-3.5 last:border-r-0 ${f.timeframe === current ? "bg-accent-soft" : ""}`}>
          <div className="flex justify-between font-extrabold">
            <span>{f.timeframe}</span>
            <span className={f.available ? TONE[f.trendSignal] : "text-ink-3"} aria-label={f.available ? f.trendSignal : "Unavailable"}>
              {f.available ? ARROW[f.trendSignal] : "–"}
            </span>
          </div>
          {f.available && f.rsi !== null ? (
            <>
              <RsiBar rsi={f.rsi} />
              <small className="num text-[11px] text-ink-3">RSI {f.rsi.toFixed(0)} · MACD {f.macdSignal.toLowerCase()}</small>
            </>
          ) : (
            <small className="text-[11px] text-ink-3">{f.unavailableReason ?? "Unavailable"}</small>
          )}
        </div>
      ))}
      </div>
    </section>
  );
}

/** RSI on a 0–100 track with the 30/70 bands marked. */
function RsiBar({ rsi }: { rsi: number }) {
  const x = Math.min(100, Math.max(0, rsi));
  const fill = rsi >= 70 ? "fill-down" : rsi <= 30 ? "fill-up" : "fill-ink-2";
  return (
    <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full" aria-hidden="true">
      <rect x="0" y="2" width="100" height="4" rx="2" className="fill-wash" />
      <rect x="30" y="2" width="40" height="4" className="fill-line" />
      <rect x={Math.max(0, x - 2)} y="0" width="4" height="8" rx="1" className={fill} />
    </svg>
  );
}
