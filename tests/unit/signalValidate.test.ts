import { describe, it, expect } from "vitest";
import { checkSignal, signalInput } from "@/lib/signals/validate";

const base = { symbol: "XAUUSD.ec", side: "BUY", entry: 2650, stop: 2638, tps: [2656, 2662], riskPct: 0.5, execute: true, post: true };
const ctx = { symbols: ["XAUUSD.ec", "SOLUSD.ec"] };
const check = (over: Record<string, unknown>) => checkSignal(signalInput.parse({ ...base, ...over }), ctx);

describe("signalInput", () => {
  it("fills defaults", () => {
    const s = signalInput.parse({ symbol: "XAUUSD.ec", side: "BUY", stop: 2638, execute: true, post: false });
    expect(s).toMatchObject({ entry: null, tps: [], riskPct: 0.5, maxDeviation: null, note: null });
  });
  it("caps risk at 1%", () => expect(() => signalInput.parse({ ...base, riskPct: 1.5 })).toThrow());
  it("allows at most 4 TPs", () => expect(() => signalInput.parse({ ...base, tps: [1, 2, 3, 4, 5] })).toThrow());
  it("requires a stop", () => expect(() => signalInput.parse({ ...base, stop: undefined })).toThrow());
});

describe("checkSignal", () => {
  it("accepts a valid long", () => expect(check({})).toEqual([]));
  it("accepts a valid short", () => expect(check({ side: "SELL", stop: 2660, tps: [2640, 2630] })).toEqual([]));
  it("needs the stop below a long's entry", () => expect(check({ stop: 2660 })).toContain("stop must be below entry for a BUY"));
  it("needs the stop above a short's entry", () => expect(check({ side: "SELL", tps: [2640] })).toContain("stop must be above entry for a SELL"));
  it("needs TPs ordered away from entry", () => expect(check({ tps: [2662, 2656] })).toContain("TPs must move away from entry in order"));
  it("needs TP1 beyond entry", () => expect(check({ tps: [2645] })).toContain("TPs must move away from entry in order"));
  it("checks a market signal's TPs against the stop", () =>
    expect(check({ entry: null, tps: [2630] })).toContain("TPs must be on the profit side of the stop"));
  it("accepts a market signal", () => expect(check({ entry: null })).toEqual([]));
  it("rejects a symbol the terminal does not list when executing", () =>
    expect(check({ symbol: "BTCUSD.ec" })).toContain("BTCUSD.ec is not in the terminal's symbol list"));
  it("lets a channel-only signal use any symbol", () => expect(check({ symbol: "BTCUSD.ec", execute: false })).toEqual([]));
  it("needs entry for a channel-only signal", () =>
    expect(check({ entry: null, execute: false })).toContain("entry is required when the signal is not executed"));
  it("needs execute or post", () => expect(check({ execute: false, post: false })).toContain("choose post, execute or both"));
});
