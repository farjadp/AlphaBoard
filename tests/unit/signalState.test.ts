import { describe, it, expect } from "vitest";
import { applyReport, type LegView, type SignalView } from "@/lib/signalDesk/state";

const leg = (n: number, over: Partial<LegView> = {}): LegView => ({ leg: n, status: "OPEN", openPrice: 2650, volume: 0.01, r: null, ...over });
const sig = (over: Partial<SignalView> = {}): SignalView => ({ status: "OPEN", side: "BUY", stop: 2638, legs: [leg(1), leg(2), leg(3)], breakevenDone: false, ...over });

describe("applyReport: execution", () => {
  it("SENT + FILLED opens the signal and creates the leg, no reply", () => {
    const t = applyReport(sig({ status: "SENT", legs: [] }), { event: "FILLED", leg: 1, ticket: "9", volume: 0.02, price: 2650.4, tp: 2656 });
    expect(t).toEqual({ status: "OPEN", legCreate: { leg: 1, ticket: "9", volume: 0.02, openPrice: 2650.4, tp: 2656 }, reply: null });
  });
  it("a repeated FILLED for a known leg changes nothing", () => {
    const t = applyReport(sig({ legs: [leg(1)] }), { event: "FILLED", leg: 1, ticket: "9", volume: 0.01, price: 2650, tp: null });
    expect(t).toEqual({ status: "OPEN", reply: null });
  });
  it("SENT + REJECTED rejects with the reason", () =>
    expect(applyReport(sig({ status: "SENT", legs: [] }), { event: "REJECTED", reason: "price moved" }))
      .toEqual({ status: "REJECTED", reason: "price moved", reply: null }));
  it("a REJECTED after some legs filled keeps the signal open", () =>
    expect(applyReport(sig({ legs: [leg(1)] }), { event: "REJECTED", reason: "no money" }))
      .toEqual({ status: "OPEN", reason: "partly rejected: no money", reply: null }));
  it("SENT + DRY_RUN closes it with the reason", () =>
    expect(applyReport(sig({ status: "SENT", legs: [] }), { event: "DRY_RUN", reason: "lots=0.04 legs=3" }))
      .toEqual({ status: "CLOSED", reason: "dry run: lots=0.04 legs=3", reply: null }));
});

describe("applyReport: legs", () => {
  it("TP on leg 1 of 3 stays open and posts the R", () => {
    const t = applyReport(sig(), { event: "TP", leg: 1, price: 2656 });
    expect(t.status).toBe("OPEN");
    expect(t.legUpdate).toEqual({ leg: 1, status: "TP", closePrice: 2656, r: 0.5 });
    expect(t.reply).toBe("🎯 TP1 reached 2656 (+0.5R)");
  });
  it("R is signed for a short", () => {
    const t = applyReport(sig({ side: "SELL", stop: 2662 }), { event: "TP", leg: 2, price: 2638 });
    expect(t.legUpdate?.r).toBe(1);
    expect(t.reply).toBe("🎯 TP2 reached 2638 (+1R)");
  });
  it("the last leg at TP closes the signal with a summary", () => {
    const s = sig({ legs: [leg(1, { status: "TP", r: 0.5 }), leg(2, { status: "TP", r: 1 }), leg(3)] });
    const t = applyReport(s, { event: "TP", leg: 3, price: 2668 });
    expect(t.status).toBe("CLOSED");
    expect(t.reply).toBe("🎯 TP3 reached 2668 (+1.5R)\n🏁 All targets reached\nResult +1R");
  });
  it("the result is weighted by volume", () => {
    const s = sig({ legs: [leg(1, { status: "TP", r: 0.5, volume: 0.02 }), leg(2, { volume: 0.01 })] });
    expect(applyReport(s, { event: "SL", leg: 2, price: 2650 }).reply).toBe("⚖️ Stopped at entry (0R)\nResult +0.33R");
  });
  it("a stop at the original stop is −1R, posted once on the last leg", () => {
    const first = applyReport(sig(), { event: "SL", leg: 1, price: 2638 });
    expect(first).toMatchObject({ status: "OPEN", reply: null, legUpdate: { r: -1 } });
    const s = sig({ legs: [leg(1, { status: "SL", r: -1 }), leg(2, { status: "SL", r: -1 }), leg(3)] });
    expect(applyReport(s, { event: "SL", leg: 3, price: 2638 })).toMatchObject({ status: "CLOSED", reply: "🛑 Stop hit (−1R)\nResult −1R" });
  });
  it("a stop in profit says so", () =>
    expect(applyReport(sig({ legs: [leg(1)] }), { event: "SL", leg: 1, price: 2656 }).reply).toBe("🔒 Stopped in profit (+0.5R)\nResult +0.5R"));
  it("a manual close posts once, on the last leg", () => {
    expect(applyReport(sig(), { event: "CLOSED", leg: 1, price: 2649.1 }).reply).toBeNull();
    expect(applyReport(sig({ legs: [leg(1)] }), { event: "CLOSED", leg: 1, price: 2648.8 }))
      .toMatchObject({ status: "CLOSED", reply: "✅ Closed at 2648.8\nResult −0.1R" });
  });
  it("an event for a final or unknown leg is ignored", () => {
    const s = sig({ legs: [leg(1, { status: "TP", r: 0.5 }), leg(2)] });
    expect(applyReport(s, { event: "TP", leg: 1, price: 2656 })).toEqual({ status: "OPEN", reply: null });
    expect(applyReport(s, { event: "SL", leg: 7, price: 2638 })).toEqual({ status: "OPEN", reply: null });
  });
});

describe("applyReport: breakeven", () => {
  it("posts once", () => {
    expect(applyReport(sig(), { event: "BE", price: 2650 })).toEqual({ status: "OPEN", breakeven: true, reply: "🔒 Stop moved to entry" });
    expect(applyReport(sig({ breakevenDone: true }), { event: "BE", price: 2650 })).toEqual({ status: "OPEN", reply: null });
  });
});

describe("applyReport: final signals", () => {
  it("ignores reports once the signal is closed, rejected or expired", () => {
    for (const status of ["CLOSED", "REJECTED", "EXPIRED", "CANCELLED"]) {
      expect(applyReport(sig({ status }), { event: "TP", leg: 1, price: 2656 })).toEqual({ status, reply: null });
    }
  });
  it("an UNKNOWN signal comes back to life on a fill", () =>
    expect(applyReport(sig({ status: "UNKNOWN", legs: [] }), { event: "FILLED", leg: 1, ticket: "1", volume: 0.01, price: 2650, tp: null }).status).toBe("OPEN"));
});

describe("applyReport: management (P14d)", () => {
  const open = { status: "OPEN", side: "BUY" as const, stop: 2600, breakevenDone: false, legs: [{ leg: 1, status: "OPEN" as const, openPrice: 2650, volume: 0.1, r: null, tp: 2680 }] };
  it("SL_MOVED replies with the level; TP_MOVED patches the leg and ignores a repeat", () => {
    expect(applyReport(open, { event: "SL_MOVED", price: 2640 })).toMatchObject({ status: "OPEN", reply: "🔒 Stop moved to 2640" });
    const t = applyReport(open, { event: "TP_MOVED", leg: 1, price: 2700 });
    expect(t).toMatchObject({ legPatch: { leg: 1, tp: 2700 }, reply: "🎯 TP1 moved to 2700" });
    expect(applyReport({ ...open, legs: [{ ...open.legs[0], tp: 2700 }] }, { event: "TP_MOVED", leg: 1, price: 2700 }).reply).toBeNull();
    expect(applyReport(open, { event: "TP_MOVED", leg: 3, price: 2700 }).reply).toBeNull();
  });
  it("PARTIAL shrinks the leg, reports the R of the part that closed, and is idempotent", () => {
    const t = applyReport(open, { event: "PARTIAL", leg: 1, price: 2675, volume: 0.05, left: 0.05 });
    expect(t).toMatchObject({ status: "OPEN", legPatch: { leg: 1, volume: 0.05, realizedR: 0.5, realizedVolume: 0.05 }, reply: "✂️ Closed 0.05 of leg 1 at 2675 (+0.5R)" });
    const after = { ...open, legs: [{ ...open.legs[0], volume: 0.05 }] };
    expect(applyReport(after, { event: "PARTIAL", leg: 1, price: 2675, volume: 0.05, left: 0.05 }).reply).toBeNull();
  });
});
