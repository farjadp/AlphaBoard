"use client";

import { validUntil } from "@/lib/eval/evaluator";
import { useNow } from "@/lib/client/hooks/useNow";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "14:05 UTC" for today, "04 NOV 14:05 UTC" otherwise: bulletin time, always UTC. */
export function bulletinTime(d: Date, now = new Date()): string {
  const hhmm = d.toISOString().slice(11, 16);
  const sameDay = d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  return sameDay ? `${hhmm} UTC` : `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${hhmm} UTC`;
}

/** Issue + validity stamps on a plan: when the forecast was issued and until when it is scored. */
export function IssueStamps({ issuedAt, timeframe, className = "" }: { issuedAt?: string; timeframe: string; className?: string }) {
  const now = useNow();
  if (!issuedAt) return null;
  const issued = new Date(issuedAt);
  if (Number.isNaN(issued.getTime())) return null;
  const until = validUntil(issued, timeframe);
  const expired = until && now ? until.getTime() < now.getTime() : false;
  return (
    <div className={`flex flex-wrap gap-1.5 text-ink-3 ${className}`}>
      <span className="stamp">Issued {bulletinTime(issued, now ?? issued)}</span>
      {until && <span className={`stamp ${expired ? "text-amber" : "text-accent"}`}>{expired ? "Expired" : "Valid to"} {bulletinTime(until, now ?? issued)}</span>}
    </div>
  );
}

/** Direction glyph drawn as a front symbol: rising triangle, falling triangle, or a flat bar. */
export function DirectionGlyph({ direction }: { direction: "long" | "short" | "none" }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="fill-current">
      {direction === "long" ? <path d="M5 1 L9.5 9 H0.5 Z" /> : direction === "short" ? <path d="M5 9 L9.5 1 H0.5 Z" /> : <rect x="0.5" y="3.5" width="9" height="3" />}
    </svg>
  );
}
