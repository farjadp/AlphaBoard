"use client";

import { useNow } from "@/lib/client/useNow";
import { marketSessions, sessionHeadline, type SessionState } from "@/lib/market/sessions";

// Two lanes keep overlapping sessions readable: Asia-Pacific/Europe on top, Tokyo/Americas below.
const LANE: Record<SessionState["key"], 0 | 1> = { sydney: 0, london: 0, tokyo: 1, newyork: 1 };

/** Exchange sessions on the viewer's own 24h day, with a marker for "now". */
export default function SessionBand() {
  const now = useNow();
  if (!now) return <div className="h-[60px]" aria-hidden="true" />;

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const sessions = marketSessions(now, dayStart);
  const nowFrac = (now.getTime() - dayStart.getTime()) / 86_400_000;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").at(-1)!.replace(/_/g, " ");
  const headline = sessionHeadline(sessions);
  const [status, detail] = headline.split(" · ");

  return (
    <section aria-label="Market sessions" className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 md:flex-nowrap md:px-6">
      <span className="label-caps hidden whitespace-nowrap md:inline">Sessions · {tz} time</span>
      <div className="relative h-9 min-w-0 basis-full overflow-hidden md:basis-auto md:flex-1 rounded-md border border-line bg-paper" role="img" aria-label={headline}>
        {/* 06:00, 12:00, 18:00 gridlines */}
        {["left-1/4", "left-1/2", "left-3/4"].map((pos) => (
          <span key={pos} className={`absolute inset-y-0 w-px bg-line ${pos}`} />
        ))}
        {sessions.flatMap((s) => s.segments.map((seg, i) => {
          const width = (seg.end - seg.start) * 100;
          return (
            <span
              key={`${s.key}-${i}`}
              title={`${s.city} ${s.hoursLabel} local · ${s.status}`}
              className={`absolute h-[13px] truncate rounded px-1.5 text-[10px] font-bold leading-[13px] ${LANE[s.key] === 0 ? "top-[3px]" : "top-[18px]"} ${s.isOpen ? "bg-accent-soft text-accent" : "bg-wash text-ink-3"}`}
              style={{ left: `${seg.start * 100}%`, width: `${width}%` }}
            >
              {width > 12 ? s.city : ""}
            </span>
          );
        }))}
        <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${nowFrac * 100}%` }} />
      </div>
      <span className="text-[13px] font-semibold text-ink-2 md:whitespace-nowrap">
        <b className="text-ink">{status}</b>{detail ? ` · ${detail}` : ""}
      </span>
    </section>
  );
}
