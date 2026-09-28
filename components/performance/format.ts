import type { SignalOutcome } from "@/lib/eval/evaluator";

export const r = (n: number | null | undefined, signed = true) =>
  n == null || !Number.isFinite(n) ? "—" : `${signed && n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;
export const pctOrDash = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(0)}%`);
export const ratio = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
export const rTone = (n: number | null | undefined) =>
  n == null || n === 0 ? "text-[var(--text-2)]" : n > 0 ? "text-[var(--green)]" : "text-[var(--red)]";

export const OUTCOME: Record<SignalOutcome, { label: string; className: string }> = {
  TP_HIT: { label: "Target hit", className: "bg-[var(--green-bg)] text-[var(--green)]" },
  SL_HIT: { label: "Stopped out", className: "bg-[var(--red-bg)] text-[var(--red)]" },
  EXPIRED: { label: "Expired", className: "bg-[var(--surface-2)] text-[var(--text-2)]" },
  NO_FILL: { label: "Entry not reached", className: "bg-[var(--surface-2)] text-[var(--text-3)]" },
  OPEN: { label: "Open", className: "bg-[var(--accent-dim)] text-[var(--accent)]" },
  INVALID: { label: "Not evaluable", className: "bg-[var(--yellow-bg)] text-[var(--yellow)]" },
};
