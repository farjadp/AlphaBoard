import { describe, it, expect } from "vitest";
import { SEATS, deriveSeats, speakOrder, STALE_MS } from "@/lib/sessions/seats";
import type { SessionMessageDto, SessionRole } from "@/lib/types/sessions";

const T0 = Date.parse("2026-09-29T12:00:00.000Z");
let n = 0;

function msg(
  role: SessionRole, kind: SessionMessageDto["kind"], body: string,
  opts: { data?: unknown; cycle?: number | null; at?: number; costUsd?: number } = {},
): SessionMessageDto {
  return {
    id: `m${++n}`, role, kind, body,
    data: (opts.data ?? null) as SessionMessageDto["data"],
    costUsd: opts.costUsd ?? null,
    cycle: opts.cycle === undefined ? 1 : opts.cycle,
    createdAt: new Date(opts.at ?? T0).toISOString(),
  };
}

const notes = (stance: string, confidence: number) => ({ notes: [{ symbol: "BTC/USDT", stance, confidence, summary: "s", keyPoints: [] }] });
const seat = (rows: ReturnType<typeof deriveSeats>, role: SessionRole) => rows.find((s) => s.role === role)!;
const states = (rows: ReturnType<typeof deriveSeats>) => Object.fromEntries(rows.map((s) => [s.role, s.state]));

describe("SEATS", () => {
  it("seats every agent role once, and no engine-only roles like SYSTEM or USER", () => {
    expect(SEATS.map((s) => s.role)).toEqual(["MARKET", "NEWS", "BULL", "BEAR", "STRATEGIST", "RISK", "EXECUTOR", "JOURNAL"]);
    expect(new Set(SEATS.map((s) => s.name)).size).toBe(SEATS.length);
  });
});

describe("deriveSeats", () => {
  it("leaves every seat idle before the first cycle posts anything", () => {
    const rows = deriveSeats([], { debate: true, now: T0 });
    expect(Object.values(states(rows)).every((s) => s === "idle")).toBe(true);
    expect(rows.every((s) => s.speaking === false)).toBe(true);
  });

  it("marks the analyst that has not answered yet as thinking, the other as speaking", () => {
    const rows = deriveSeats([msg("MARKET", "TEXT", "market note", { data: notes("bullish", 0.72) })], { debate: true, now: T0 + 5_000 });
    expect(states(rows)).toMatchObject({ MARKET: "speaking", NEWS: "thinking", BULL: "idle", STRATEGIST: "idle" });
    expect(seat(rows, "MARKET").meta).toBe("bullish 0.72");
    expect(seat(rows, "MARKET").lastBody).toBe("market note");
  });

  it("moves the debate seats to thinking once both analysts have answered", () => {
    const rows = deriveSeats([
      msg("MARKET", "TEXT", "m", { data: notes("bullish", 0.72) }),
      msg("NEWS", "TEXT", "n", { data: notes("neutral", 0.31), at: T0 + 1_000 }),
    ], { debate: true, now: T0 + 5_000 });
    expect(states(rows)).toMatchObject({ MARKET: "done", NEWS: "speaking", BULL: "thinking", BEAR: "thinking", STRATEGIST: "idle" });
    expect(seat(rows, "NEWS").meta).toBe("neutral 0.31");
  });

  it("skips the debate seats entirely when the mandate has debate off", () => {
    const rows = deriveSeats([
      msg("MARKET", "TEXT", "m", { data: notes("bullish", 0.7) }),
      msg("NEWS", "TEXT", "n", { data: notes("bearish", 0.5), at: T0 + 1_000 }),
    ], { debate: false, now: T0 + 5_000 });
    expect(states(rows)).toMatchObject({ BULL: "idle", BEAR: "idle", STRATEGIST: "thinking" });
  });

  it("ends the cycle at the strategist when it holds with no proposal", () => {
    const rows = deriveSeats([
      msg("MARKET", "TEXT", "m"), msg("NEWS", "TEXT", "n"),
      msg("STRATEGIST", "TEXT", "Decision: hold", { at: T0 + 2_000 }),
    ], { debate: false, now: T0 + 5_000 });
    expect(states(rows)).toMatchObject({ STRATEGIST: "speaking", RISK: "idle", EXECUTOR: "idle" });
    expect(seat(rows, "STRATEGIST").meta).toBe("hold");
  });

  it("hands the cycle to the rule engine when the strategist proposes", () => {
    const rows = deriveSeats([
      msg("MARKET", "TEXT", "m"), msg("NEWS", "TEXT", "n"),
      msg("STRATEGIST", "TEXT", "commentary", { at: T0 + 2_000 }),
      msg("STRATEGIST", "PROPOSAL", "OPEN_LONG BTC/USDT", { at: T0 + 2_100 }),
    ], { debate: false, now: T0 + 5_000 });
    expect(states(rows)).toMatchObject({ STRATEGIST: "speaking", RISK: "thinking" });
    expect(seat(rows, "STRATEGIST").meta).toBe("1 decision");
  });

  it("counts verdicts and fills cumulatively across the session", () => {
    const rows = deriveSeats([
      msg("STRATEGIST", "PROPOSAL", "p", { cycle: 1 }),
      msg("RISK", "VERDICT", "Approved", { data: { kind: "approved" }, cycle: 1, at: T0 + 1_000 }),
      msg("EXECUTOR", "FILL", "filled", { cycle: 1, at: T0 + 2_000 }),
      msg("STRATEGIST", "PROPOSAL", "p2", { cycle: 2, at: T0 + 60_000 }),
      msg("RISK", "VERDICT", "Clamped", { data: { kind: "clamped" }, cycle: 2, at: T0 + 61_000 }),
    ], { debate: false, now: T0 + 62_000 });
    expect(seat(rows, "RISK").meta).toBe("1 ok · 1 clamped");
    expect(seat(rows, "EXECUTOR").meta).toBe("1 fill");
    expect(states(rows)).toMatchObject({ RISK: "speaking", EXECUTOR: "thinking" });
  });

  it("resets last cycle's seats when a new cycle starts", () => {
    const rows = deriveSeats([
      msg("MARKET", "TEXT", "m", { cycle: 1 }),
      msg("NEWS", "TEXT", "n", { cycle: 1, at: T0 + 1_000 }),
      msg("STRATEGIST", "TEXT", "hold", { cycle: 1, at: T0 + 2_000 }),
      msg("MARKET", "TEXT", "m2", { data: notes("bearish", 0.4), cycle: 2, at: T0 + 60_000 }),
    ], { debate: false, now: T0 + 61_000 });
    expect(states(rows)).toMatchObject({ MARKET: "speaking", NEWS: "thinking", STRATEGIST: "idle" });
    expect(seat(rows, "MARKET").meta).toBe("bearish 0.4");
    expect(seat(rows, "MARKET").cycle).toBe(2);
  });

  it("drops a thinking seat to waiting once the cycle has gone quiet past the agent timeout", () => {
    const rows = deriveSeats([msg("MARKET", "TEXT", "m")], { debate: true, now: T0 + STALE_MS + 1 });
    expect(states(rows)).toMatchObject({ MARKET: "speaking", NEWS: "waiting" });
  });

  it("keeps the journal seat idle until a trade closes, then reports its lessons", () => {
    const idle = deriveSeats([msg("MARKET", "TEXT", "m")], { debate: false, now: T0 });
    expect(seat(idle, "JOURNAL").state).toBe("idle");
    const written = deriveSeats([
      msg("MARKET", "TEXT", "m"),
      msg("JOURNAL", "TEXT", "lesson", { cycle: null, at: T0 + 1_000 }),
    ], { debate: false, now: T0 + 2_000 });
    expect(seat(written, "JOURNAL").state).toBe("done");
    expect(seat(written, "JOURNAL").meta).toBe("1 lesson");
  });

  it("never lets a system or owner message take the floor", () => {
    const rows = deriveSeats([
      msg("MARKET", "TEXT", "m"),
      msg("SYSTEM", "ALERT", "budget warning", { at: T0 + 1_000 }),
      msg("USER", "TEXT", "close it", { at: T0 + 1_500 }),
    ], { debate: true, now: T0 + 2_000 });
    expect(seat(rows, "MARKET").speaking).toBe(true);
    expect(rows.filter((s) => s.speaking)).toHaveLength(1);
  });

  it("sums the AI cost each seat has spent in the session", () => {
    const rows = deriveSeats([
      msg("MARKET", "TEXT", "m", { costUsd: 0.004 }),
      msg("MARKET", "TEXT", "m2", { costUsd: 0.006, cycle: 2, at: T0 + 60_000 }),
      msg("EXECUTOR", "FILL", "f", { cycle: 2, at: T0 + 61_000 }),
    ], { debate: false, now: T0 + 62_000 });
    expect(seat(rows, "MARKET").costUsd).toBeCloseTo(0.01, 6);
    expect(seat(rows, "EXECUTOR").costUsd).toBe(0);
  });
});

describe("speakOrder", () => {
  it("is empty when nobody has spoken this cycle yet", () => {
    expect(speakOrder([], 1)).toEqual([]);
  });

  it("lists seats in the order they first posted within the given cycle", () => {
    const rows = [
      msg("MARKET", "TEXT", "m", { cycle: 1 }),
      msg("NEWS", "TEXT", "n", { cycle: 1, at: T0 + 1_000 }),
      msg("BULL", "TEXT", "b", { cycle: 1, at: T0 + 2_000 }),
      msg("BEAR", "TEXT", "r", { cycle: 1, at: T0 + 2_500 }),
      msg("STRATEGIST", "TEXT", "c", { cycle: 1, at: T0 + 3_000 }),
      msg("STRATEGIST", "PROPOSAL", "p", { cycle: 1, at: T0 + 3_100 }),
      msg("RISK", "VERDICT", "v", { cycle: 1, at: T0 + 3_500 }),
      msg("EXECUTOR", "FILL", "f", { cycle: 1, at: T0 + 4_000 }),
    ];
    expect(speakOrder(rows, 1)).toEqual(["MARKET", "NEWS", "BULL", "BEAR", "STRATEGIST", "RISK", "EXECUTOR"]);
  });

  it("ignores messages from other cycles and from non-seat roles", () => {
    const rows = [
      msg("MARKET", "TEXT", "m", { cycle: 1 }),
      msg("SYSTEM", "ALERT", "a", { cycle: 1, at: T0 + 500 }),
      msg("USER", "TEXT", "u", { cycle: 1, at: T0 + 600 }),
      msg("NEWS", "TEXT", "n", { cycle: 2, at: T0 + 60_000 }),
    ];
    expect(speakOrder(rows, 1)).toEqual(["MARKET"]);
  });

  it("a no-setup cycle leaves the debate and strategist idle, not thinking", () => {
    const rows = deriveSeats([
      msg("MARKET", "TEXT", "m", { data: notes("neutral", 0.5) }),
      msg("NEWS", "TEXT", "n", { data: notes("neutral", 0.3) }),
      msg("SYSTEM", "TEXT", "No setup: …", { data: { noSetup: true } }),
    ], { debate: true, now: T0 + 5_000 });
    expect(states(rows)).toMatchObject({ BULL: "idle", BEAR: "idle", STRATEGIST: "idle", MARKET: "done", NEWS: "speaking" });
  });
});

