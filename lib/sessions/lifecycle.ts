/** Session state machine (spec §4.3). Pure. */
import type { SessionStatus } from "@/lib/types/sessions";

export const ACTIVE_STATUSES = ["RUNNING", "PAUSED", "AWAITING_EXTENSION", "ENDING"] as const satisfies readonly SessionStatus[];
export const isActive = (s: SessionStatus) => (ACTIVE_STATUSES as readonly SessionStatus[]).includes(s);

const EDGES: Record<SessionStatus, SessionStatus[]> = {
  RUNNING: ["PAUSED", "AWAITING_EXTENSION", "ENDING", "ENDED", "HALTED"],
  PAUSED: ["RUNNING", "AWAITING_EXTENSION", "ENDING", "ENDED", "HALTED"],
  AWAITING_EXTENSION: ["RUNNING", "ENDING", "ENDED", "HALTED"],
  ENDING: ["ENDED", "HALTED"],
  ENDED: [],
  HALTED: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return EDGES[from].includes(to);
}

/** Only a running session opens new positions; exits run in every state. */
export const acceptsEntries = (s: SessionStatus) => s === "RUNNING";

export type TimerEvent = "PROMPT_EXTENSION" | "EXTENSION_TIMEOUT" | null;

/** What the clock requires now: ask to extend at endsAt, give up after the timeout. */
export function timerTransition(o: {
  status: SessionStatus;
  now: number;
  endsAt: number;
  extensionPromptAt: number | null;
  extensionTimeoutMin: number;
}): TimerEvent {
  if ((o.status === "RUNNING" || o.status === "PAUSED") && o.now >= o.endsAt) return "PROMPT_EXTENSION";
  if (o.status === "AWAITING_EXTENSION") {
    const since = o.extensionPromptAt ?? o.endsAt;
    if (o.now >= since + o.extensionTimeoutMin * 60_000) return "EXTENSION_TIMEOUT";
  }
  return null;
}
