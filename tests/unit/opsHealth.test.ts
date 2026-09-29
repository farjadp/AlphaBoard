import { describe, it, expect } from "vitest";
import { fingerprint, overallStatus, tickHealth } from "@/lib/ops/health";

const now = new Date("2026-09-28T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();

describe("tickHealth", () => {
  it("classifies the scheduler by the age of its last run", () => {
    expect(tickHealth(null, now)).toMatchObject({ state: "never" });
    expect(tickHealth({ at: ago(50), ms: 900, errors: [] }, now)).toMatchObject({ state: "ok", ageSec: 50 });
    expect(tickHealth({ at: ago(150), ms: 900, errors: [] }, now)).toMatchObject({ state: "late" });
    expect(tickHealth({ at: ago(600), ms: 900, errors: [] }, now)).toMatchObject({ state: "stale" });
  });
  it("a recent run that reported errors is degraded, not ok", () => {
    expect(tickHealth({ at: ago(30), ms: 900, errors: ["BTC/USDT candles: timeout"] }, now)).toMatchObject({ state: "degraded" });
  });
});

describe("overallStatus", () => {
  it("is the worst of database, scheduler and recent errors", () => {
    expect(overallStatus({ db: true, tick: "ok", errorsLastHour: 0 })).toBe("ok");
    expect(overallStatus({ db: true, tick: "degraded", errorsLastHour: 0 })).toBe("warn");
    expect(overallStatus({ db: true, tick: "ok", errorsLastHour: 3 })).toBe("warn");
    expect(overallStatus({ db: true, tick: "stale", errorsLastHour: 0 })).toBe("down");
    expect(overallStatus({ db: false, tick: "ok", errorsLastHour: 0 })).toBe("down");
  });
});

describe("fingerprint", () => {
  it("groups the same failure even when ids, numbers and times differ", () => {
    const a = fingerprint("http", "POST /api/paper/positions/cmulk123abc/close: timeout after 10000ms");
    const b = fingerprint("http", "POST /api/paper/positions/cmzzz999xyz/close: timeout after 12000ms");
    expect(a).toBe(b);
    expect(fingerprint("tick", "same")).not.toBe(fingerprint("http", "same"));
  });
});
