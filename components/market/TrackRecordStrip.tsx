import Link from "next/link";
import type { TrackRecord, Outcome } from "@/lib/eval/trackRecord";

const LABEL: Record<Outcome, string> = {
  TP_HIT: "Target hit", SL_HIT: "Stopped out", EXPIRED: "Expired", NO_FILL: "Entry not reached", OPEN: "Still open", INVALID: "Not evaluable",
};

/** Filled = graded (green target / red stop / grey expired), ring = not graded yet. Shape and text back up colour. */
function dotClass(status: Outcome, r: number | null) {
  switch (status) {
    case "TP_HIT": return "bg-up";
    case "SL_HIT": return "bg-down";
    case "EXPIRED": return r != null && r > 0 ? "bg-up/50" : "bg-ink-3";
    case "OPEN": return "border-2 border-accent bg-paper";
    default: return "border-2 border-line-2 bg-paper";
  }
}

const rFmt = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function TrackRecordStrip({ record, symbol, timeframe, timeframeLabel }: { record: TrackRecord; symbol: string; timeframe: string; timeframeLabel: string }) {
  const href = `/performance?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`;
  const { graded } = record;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[12.5px] font-bold text-ink">Your record on {symbol} · {timeframeLabel}</p>
        <Link href={href} className="inline-flex min-h-6 shrink-0 items-center text-[12px] font-bold text-accent hover:underline">Performance →</Link>
      </div>
      {record.recent.length > 0 && (
        <ol aria-label={`Last ${record.recent.length} signals, oldest first`} className="flex items-center gap-1.5">
          {record.recent.map((s) => {
            const text = `${day(s.at)} · ${LABEL[s.status]}${s.rMultiple != null ? ` · ${rFmt(s.rMultiple)}` : ""} · stated confidence ${s.confidence}%`;
            return (
              <li key={s.id} title={text} className={`h-2.5 w-2.5 rounded-full ${dotClass(s.status, s.rMultiple)}`}>
                <span className="sr-only">{text}</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-[12px] leading-relaxed text-ink-2">
        {graded > 0 ? (
          <>
            <span className="num font-semibold text-ink">{record.wins}</span> of <span className="num font-semibold text-ink">{graded}</span> graded signals won
            {record.winRate != null && <> (<span className="num">{record.winRate.toFixed(0)}%</span>)</>}, averaging{" "}
            <span className={`num font-semibold ${record.expectancyR! > 0 ? "text-up" : record.expectancyR! < 0 ? "text-down" : "text-ink"}`}>{rFmt(record.expectancyR!)}</span> per signal
            {record.open > 0 && <> · {record.open} still open</>}.
            {graded < 10 && <span className="text-ink-3"> Small sample: a hint, not a verdict.</span>}
          </>
        ) : record.recent.length > 0 ? (
          <>None graded yet{record.open > 0 && <> ({record.open} still open)</>}. Outcomes appear here once price reaches the target or the stop.</>
        ) : (
          <>No plans here yet. Every plan you generate is graded against what price does next.</>
        )}
      </p>
    </div>
  );
}
