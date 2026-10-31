/**
 * Seat state for the table view, derived from the room's own messages — no new fields, no new
 * endpoint. The cycle runs analysts (in parallel) → debate → chair → gatekeeper → hand, so who is
 * still expected to speak follows from what this cycle has already posted. A quiet cycle past the
 * agent timeout is reported as `waiting` rather than a seat that pretends to still be thinking.
 */
import { SEAT_CAST, type CastMember, type SeatRole } from "@/lib/agents/cast";
import type { SessionMessageDto } from "@/lib/types/sessions";

/** Matches TIMEOUT_MS in lib/agents/run.ts: past this, a pending call is not coming back. */
export const STALE_MS = 90_000;

export const SEATS = SEAT_CAST;

export type SeatState = "idle" | "thinking" | "speaking" | "waiting" | "done";

export interface Seat extends CastMember {
  state: SeatState;
  speaking: boolean;
  /** Third line: this seat's result or standing count. Null when it has nothing to report yet. */
  meta: string | null;
  lastBody: string | null;
  lastAt: string | null;
  costUsd: number;
  cycle: number | null;
}

/** How far through a cycle each seat sits. The journal runs outside the cycle, on a close.
 * Exported so views that draw a stage rail (the round table) read the same map the derivation uses. */
export const SEAT_STAGE: Record<SeatRole, number> = { MARKET: 0, NEWS: 0, BULL: 1, BEAR: 1, STRATEGIST: 2, RISK: 3, EXECUTOR: 4, JOURNAL: -1 };
export const STAGE_LABEL = ["analysts", "debate", "chair", "gatekeeper", "hand"] as const;

const SEAT_ROLES = new Set<string>(SEAT_CAST.map((c) => c.role));
const isSeat = (m: SessionMessageDto): m is SessionMessageDto & { role: SeatRole } => SEAT_ROLES.has(m.role);

/** Verdicts that let the hand act; `rejected` and `hold` end the decision at the gatekeeper. */
const PASSING = new Set(["approved", "clamped", "close", "tighten"]);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const num = (n: number) => String(Math.round(n * 100) / 100);
const verdictKind = (m: SessionMessageDto) => (m.data as { kind?: string } | null)?.kind ?? null;

type Note = { stance: string; confidence: number };
function strongestNote(m: SessionMessageDto): Note | null {
  const notes = (m.data as { notes?: Note[] } | null)?.notes;
  if (!notes?.length) return null;
  return notes.reduce((best, n) => (n.confidence > best.confidence ? n : best));
}

/** The order seats first spoke in one cycle, for drawing a conversation thread between them.
 * Each seat appears once, at its first message — a strategist's later PROPOSAL does not move it. */
export function speakOrder(messages: SessionMessageDto[], cycle: number): SeatRole[] {
  const seen = new Set<SeatRole>();
  const order: SeatRole[] = [];
  for (const m of messages) {
    if (m.cycle !== cycle || !isSeat(m) || seen.has(m.role)) continue;
    seen.add(m.role);
    order.push(m.role);
  }
  return order;
}

export function deriveSeats(messages: SessionMessageDto[], opts: { debate: boolean; now: number }): Seat[] {
  const cycles = messages.map((m) => m.cycle).filter((c): c is number => c != null);
  const cycle = cycles.length ? Math.max(...cycles) : null;
  const inCycle = cycle == null ? [] : messages.filter((m) => m.cycle === cycle);

  const costUsd = new Map<string, number>();
  const lastOwn = new Map<string, SessionMessageDto>();
  let ok = 0, clamped = 0, rejected = 0, fills = 0, lessons = 0;
  for (const m of messages) {
    if (m.costUsd) costUsd.set(m.role, (costUsd.get(m.role) ?? 0) + m.costUsd);
    if (isSeat(m)) lastOwn.set(m.role, m);
    if (m.kind === "VERDICT") {
      const k = verdictKind(m);
      if (k === "clamped") clamped += 1;
      else if (k === "rejected") rejected += 1;
      else if (k && PASSING.has(k)) ok += 1;
    }
    if (m.kind === "FILL") fills += 1;
    if (m.role === "JOURNAL") lessons += 1;
  }

  const posted = new Set(inCycle.filter(isSeat).map((m) => m.role));
  const speakingRole = [...inCycle].reverse().find(isSeat)?.role ?? null;
  const proposals = inCycle.filter((m) => m.kind === "PROPOSAL").length;
  const verdicts = inCycle.filter((m) => m.kind === "VERDICT");
  const lastAt = messages.length ? Date.parse(messages[messages.length - 1]!.createdAt) : null;
  const stale = lastAt != null && opts.now - lastAt > STALE_MS;

  // The furthest stage this cycle has reached, so a stage that failed or was skipped does not
  // strand the seats behind it: a proposal on the table means the gatekeeper is up, notes or not.
  const pending = new Set<SeatRole>();
  // A cycle the code cut short on purpose (no setup → no debate or strategist) leaves nobody waiting.
  const cutShort = inCycle.some((m) => m.role === "SYSTEM" && (m.data as { noSetup?: boolean } | null)?.noSetup === true);
  if (cycle != null && !cutShort) {
    let reached = -1;
    for (const r of posted) reached = Math.max(reached, SEAT_STAGE[r]);
    const want = (stage: number) => {
      if (stage === SEAT_STAGE.MARKET) {
        if (!posted.has("MARKET")) pending.add("MARKET");
        if (!posted.has("NEWS")) pending.add("NEWS");
      } else if (stage === SEAT_STAGE.BULL && opts.debate) {
        if (!posted.has("BULL")) pending.add("BULL");
        if (!posted.has("BEAR")) pending.add("BEAR");
      } else if (stage === SEAT_STAGE.STRATEGIST) {
        if (!posted.has("STRATEGIST")) pending.add("STRATEGIST");
      } else if (stage === SEAT_STAGE.RISK) {
        if (proposals > 0 && !verdicts.length) pending.add("RISK");
      } else if (stage === SEAT_STAGE.EXECUTOR) {
        if (!posted.has("EXECUTOR") && verdicts.some((v) => PASSING.has(verdictKind(v) ?? ""))) pending.add("EXECUTOR");
      }
    };
    for (let stage = Math.max(reached, 0); stage <= SEAT_STAGE.EXECUTOR && !pending.size; stage += 1) want(stage);
  }

  return SEAT_CAST.map((c) => {
    const own = lastOwn.get(c.role) ?? null;
    const speaking = c.role === speakingRole;
    const state: SeatState = speaking ? "speaking"
      : pending.has(c.role) ? (stale ? "waiting" : "thinking")
      : posted.has(c.role) || (c.role === "JOURNAL" && lessons > 0) ? "done"
      : "idle";
    return {
      ...c, state, speaking, cycle,
      meta: metaFor(c.role, { own: posted.has(c.role) ? own : null, proposals, ok, clamped, rejected, fills, lessons }),
      lastBody: own?.body ?? null,
      lastAt: own?.createdAt ?? null,
      costUsd: costUsd.get(c.role) ?? 0,
    };
  });
}

function metaFor(role: SeatRole, x: {
  own: SessionMessageDto | null; proposals: number; ok: number; clamped: number; rejected: number; fills: number; lessons: number;
}): string | null {
  switch (role) {
    case "MARKET":
    case "NEWS": {
      const note = x.own && strongestNote(x.own);
      return note ? `${note.stance} ${num(note.confidence)}` : null;
    }
    case "STRATEGIST":
      return x.proposals ? plural(x.proposals, "decision") : x.own ? "hold" : null;
    case "RISK": {
      const parts = [
        x.ok ? `${x.ok} ok` : null,
        x.clamped ? `${x.clamped} clamped` : null,
        x.rejected ? `${x.rejected} rejected` : null,
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    }
    case "EXECUTOR":
      return x.fills ? plural(x.fills, "fill") : null;
    case "JOURNAL":
      return x.lessons ? plural(x.lessons, "lesson") : null;
    default:
      return null;
  }
}
