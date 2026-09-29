/**
 * The desk cast: the identity each session role wears in the room and at the table.
 * Names are archetypes, not people — and the two deterministic engines say so in their title,
 * so nobody reads "The Gatekeeper" as an AI that chose the size.
 */
import type { SessionRole } from "@/lib/types/sessions";

export type SeatRole = "MARKET" | "NEWS" | "BULL" | "BEAR" | "STRATEGIST" | "RISK" | "EXECUTOR" | "JOURNAL";

export interface CastMember {
  role: SeatRole;
  name: string;
  /** Second line on the seat: what this chair does, and whether a model or code sits in it. */
  title: string;
  /** Longer description, shown on hover next to the model that is seated. */
  blurb: string;
  kind: "ai" | "engine";
  /** Two-letter monogram; distinct across the whole cast, so no two seats share a badge. */
  badge: string;
  /** Which model slot in the mandate staffs this seat; engines have none. */
  model: "analyst" | "strategist" | "journal" | null;
  tone: { fill: string; text: string; badge: string };
}

const AI_ACCENT = { fill: "bg-accent-soft", text: "text-accent", badge: "bg-accent-soft text-accent" };
const AI_INK = { fill: "bg-ink/[0.06]", text: "text-ink", badge: "bg-ink text-paper" };
const UP = { fill: "bg-up-soft", text: "text-up", badge: "bg-up-soft text-up" };
const DOWN = { fill: "bg-down-soft", text: "text-down", badge: "bg-down-soft text-down" };
const ENGINE = { fill: "bg-wash", text: "text-ink-2", badge: "bg-wash text-ink-2" };
const AMBER = { fill: "bg-amber-soft", text: "text-amber", badge: "bg-amber-soft text-amber" };

/** Seats in the order the cycle uses them — the table and the legend both read from this. */
export const SEAT_CAST: CastMember[] = [
  {
    role: "MARKET", badge: "CH", name: "The Chartist", title: "technicals · AI", model: "analyst", kind: "ai", tone: AI_ACCENT,
    blurb: "Reads the multi-timeframe trend, momentum, stretch and volatility. Proposes no trades.",
  },
  {
    role: "NEWS", badge: "WR", name: "The Wire", title: "headlines · AI", model: "analyst", kind: "ai", tone: AI_ACCENT,
    blurb: "Weighs ranked headlines, funding and positioning as a tailwind, a headwind or noise.",
  },
  {
    role: "BULL", badge: "BL", name: "The Bull", title: "case for risk · AI", model: "strategist", kind: "ai", tone: UP,
    blurb: "Argues once for taking risk now, in at most 120 words, grounded in the analyst notes.",
  },
  {
    role: "BEAR", badge: "BR", name: "The Bear", title: "case for flat · AI", model: "strategist", kind: "ai", tone: DOWN,
    blurb: "Argues once for staying flat or reducing risk, in at most 120 words.",
  },
  {
    role: "STRATEGIST", badge: "CR", name: "The Chair", title: "decides the cycle · AI", model: "strategist", kind: "ai", tone: AI_INK,
    blurb: "Turns the notes and the debate into one plan per symbol, each with a stop and an invalidation. Does not size anything.",
  },
  {
    role: "RISK", badge: "GK", name: "The Gatekeeper", title: "deterministic · rule engine", model: null, kind: "engine", tone: AMBER,
    blurb: "Code, not a model. Sizes every proposal from the stop distance and the mandate, clamps it, or vetoes it outright.",
  },
  {
    role: "EXECUTOR", badge: "HD", name: "The Hand", title: "places orders · engine", model: null, kind: "engine", tone: ENGINE,
    blurb: "Code, not a model. Sends the order to the venue, books the fill and arms the stop.",
  },
  {
    role: "JOURNAL", badge: "SC", name: "The Scribe", title: "lessons · AI", model: "journal", kind: "ai", tone: ENGINE,
    blurb: "Writes an honest post-mortem when a trade closes, and the session report at the end.",
  },
];

const BY_ROLE = new Map(SEAT_CAST.map((c) => [c.role, c]));

/** Every role that can speak in the room, including the two that own no seat. */
interface RoomName { name: string; title: string; badge: string; tone: string; kind: "ai" | "engine" | "desk" }

export const CAST: Record<SessionRole, RoomName> = {
  ...(Object.fromEntries(SEAT_CAST.map((c) => [c.role, {
    name: c.name, title: c.title, badge: c.badge, tone: c.tone.badge, kind: c.kind,
  }])) as Record<SeatRole, RoomName>),
  SYSTEM: { name: "The Bell", title: "opens, closes, alerts", badge: "BE", tone: "bg-wash text-ink-3", kind: "desk" },
  USER: { name: "The Owner", title: "you", badge: "OW", tone: "bg-ink text-paper", kind: "desk" },
};

export const castFor = (role: SeatRole) => BY_ROLE.get(role)!;
