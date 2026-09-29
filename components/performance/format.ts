import type { SignalOutcome } from "@/lib/eval/evaluator";

export const r = (n: number | null | undefined, signed = true) =>
  n == null || !Number.isFinite(n) ? "—" : `${signed && n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;
export const pctOrDash = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(0)}%`);
export const ratio = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
export const rTone = (n: number | null | undefined) =>
  n == null || n === 0 ? "text-ink-2" : n > 0 ? "text-up" : "text-down";

export const OUTCOME: Record<SignalOutcome, { label: string; className: string }> = {
  TP_HIT: { label: "Target hit", className: "bg-up-soft text-up" },
  SL_HIT: { label: "Stopped out", className: "bg-down-soft text-down" },
  EXPIRED: { label: "Expired", className: "bg-wash text-ink-2" },
  NO_FILL: { label: "Entry not reached", className: "bg-wash text-ink-3" },
  OPEN: { label: "Open", className: "bg-accent-soft text-accent" },
  INVALID: { label: "Not evaluable", className: "bg-amber-soft text-amber" },
};
