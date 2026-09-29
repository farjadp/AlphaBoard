import type { SignalOutcome } from "@/lib/eval/evaluator";
import { OUTCOME, r } from "./format";

/** Text + tint, never color alone. */
export default function OutcomeBadge({ status, rMultiple, note }: { status: SignalOutcome; rMultiple: number | null; note?: string | null }) {
  const o = OUTCOME[status];
  return (
    <span title={note ?? undefined} className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${o.className}`}>
      {o.label}{rMultiple != null && <span className="tabular-nums">· {r(rMultiple)}</span>}
    </span>
  );
}
