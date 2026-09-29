/** Small shared pieces for the agent-session screens. */
import type { SessionStatus } from "@/lib/types/sessions";

export const STATUS_LABEL: Record<SessionStatus, string> = {
  RUNNING: "Running", PAUSED: "Paused", AWAITING_EXTENSION: "Waiting for you", ENDING: "Ending", ENDED: "Ended", HALTED: "Halted",
};

const STATUS_TONE: Record<SessionStatus, string> = {
  RUNNING: "bg-up-soft text-up", PAUSED: "bg-amber-soft text-amber", AWAITING_EXTENSION: "bg-accent-soft text-accent",
  ENDING: "bg-wash text-ink-2", ENDED: "bg-wash text-ink-2", HALTED: "bg-down-soft text-down",
};

export function StatusPill({ status }: { status: SessionStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}>
      {status === "RUNNING" && <span aria-hidden className="size-1.5 rounded-full bg-up motion-safe:animate-pulse" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export const END_REASON: Record<string, string> = {
  COMPLETED: "Completed", USER_ENDED: "Ended by you", LOSS_LIMIT: "Loss limit hit", KILL: "Kill switch", RECONCILE_MISMATCH: "Venue mismatch",
  LLM_BUDGET: "AI budget used", ERROR: "Errors", EXTENSION_TIMEOUT: "No answer at the end",
};

export function durationText(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function timeLeft(ms: number) {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
}

export const usd = (n: number | null | undefined, signed = false) => {
  if (n == null || !Number.isFinite(n)) return "Unavailable";
  const s = `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return signed ? `${n > 0 ? "+" : n < 0 ? "−" : ""}${s}` : n < 0 ? `−${s}` : s;
};

/** Horizontal meter; `danger` flips the colour as the bar fills (loss used, cost used). */
export function Meter({ label, value, max, text, danger = false }: { label: string; value: number | null; max: number; text: string; danger?: boolean }) {
  const ratio = value == null || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const bar = danger ? (ratio >= 0.8 ? "bg-down" : ratio >= 0.5 ? "bg-amber" : "bg-ink-3") : "bg-accent";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-caps">{label}</span>
        <span className="num truncate text-xs text-ink-2">{text}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wash" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? undefined} aria-valuetext={text}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
