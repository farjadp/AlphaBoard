import { describe, it, expect } from "vitest";
import { draftFromExtract, matchSymbol, SignalExtractSchema } from "@/lib/signalDesk/importDraft";

const SYMS = ["XAUUSD.ec", "XAGUSD.ec", "ETHUSD.ec", "XRPUSD.ec", "BTCUSD.ec", "US30.ec", "EURUSD.ec"];
const x = (o: Record<string, unknown>) => SignalExtractSchema.parse({ symbol: null, side: null, market: false, entryLow: null, entryHigh: null, stop: null, targets: [], source: null, ...o });

describe("matchSymbol", () => {
  it("maps common spellings to the terminal's symbol", () => {
    expect(matchSymbol("XAUUSD", SYMS)).toBe("XAUUSD.ec");
    expect(matchSymbol("xau/usd", SYMS)).toBe("XAUUSD.ec");
    expect(matchSymbol("GOLD", SYMS)).toBe("XAUUSD.ec");
    expect(matchSymbol("Silver", SYMS)).toBe("XAGUSD.ec");
    expect(matchSymbol("ETH/USDT", SYMS)).toBe("ETHUSD.ec");
    expect(matchSymbol("XRPUSDT.P", SYMS)).toBe("XRPUSD.ec");
    expect(matchSymbol("BTCUSDT PERP", SYMS)).toBe("BTCUSD.ec");
    expect(matchSymbol("OP", ["OPUSD.ec"])).toBe("OPUSD.ec");
    expect(matchSymbol("ETH", SYMS)).toBe("ETHUSD.ec");
    expect(matchSymbol("XAUUSD.ec", SYMS)).toBe("XAUUSD.ec");
    expect(matchSymbol("XAUUSDm", SYMS)).toBe("XAUUSD.ec");
    expect(matchSymbol("gold", SYMS)).toBe("XAUUSD.ec");
  });
  it("returns null when the terminal does not list it", () => {
    expect(matchSymbol("ALT/USDT", SYMS)).toBeNull();
    expect(matchSymbol("", SYMS)).toBeNull();
  });
});

describe("draftFromExtract", () => {
  it("Atlas-style gold buy: zone entry, four targets, stop", () => {
    const { draft, warnings } = draftFromExtract(x({ symbol: "XAUUSD", side: "BUY", entryLow: 4075, entryHigh: 4080, stop: 4063, targets: [4100, 4130, 4135, 4154], source: "Atlas Forex VIP" }), SYMS);
    expect(draft).toEqual({ symbol: "XAUUSD.ec", side: "BUY", entry: 4077.5, stop: 4063, tps: [4100, 4130, 4135, 4154], maxDeviation: 3.63, source: "Atlas Forex VIP" });
    expect(warnings).toEqual(["Entry zone 4075–4080: entry set to the middle (4077.5); the terminal accepts a fill up to 3.63 away"]);
  });
  it("keeps only the first four targets and drops ones on the wrong side", () => {
    const { draft, warnings } = draftFromExtract(x({ symbol: "XAUUSD", side: "BUY", entryLow: 4050, entryHigh: 4050, stop: 4025, targets: [4040, 4080, 4100, 4120, 4140, 4160] }), SYMS);
    expect(draft.tps).toEqual([4080, 4100, 4120, 4140]);
    expect(warnings).toContain("Dropped 1 target on the wrong side of the entry");
    expect(warnings).toContain("6 targets found; kept the first 4");
  });
  it("crypto market short with no stop", () => {
    const { draft, warnings } = draftFromExtract(x({ symbol: "XRP/USDT", side: "SELL", market: true, targets: [1.33, 1.31] }), SYMS);
    expect(draft).toMatchObject({ symbol: "XRPUSD.ec", side: "SELL", entry: null, stop: null, tps: [1.33, 1.31], maxDeviation: null });
    expect(warnings).toContain("No stop loss in the source: set one before sending");
  });
  it("infers the side from stop and targets when the text does not say it", () => {
    const { draft, warnings } = draftFromExtract(x({ symbol: "GOLD", entryLow: 4050, entryHigh: 4055, stop: 4042, targets: [4065] }), SYMS);
    expect(draft.side).toBe("BUY");
    expect(warnings).toContain("Side was not stated; read as BUY from the stop and targets");
  });
  it("orders a short's targets downward", () => {
    expect(draftFromExtract(x({ symbol: "ETHUSDT", side: "SELL", entryLow: 2450, entryHigh: 2450, stop: 2500, targets: [2350, 2400, 2300] }), SYMS).draft.tps).toEqual([2400, 2350, 2300]);
  });
  it("keeps an unmatched symbol and says so", () => {
    const { draft, warnings } = draftFromExtract(x({ symbol: "ALT/USDT", side: "SELL", market: true, stop: 0.0135 }), SYMS);
    expect(draft.symbol).toBe("ALTUSDT");
    expect(warnings).toContain("ALTUSDT is not in your terminal's symbol list");
  });
  it("normalizes the model's loose output", () => {
    const e = SignalExtractSchema.parse({ symbol: " xauusd ", side: "long", market: "false", entryLow: "4,075", entryHigh: "4080", stop: "4063", targets: ["4100", null, "x"], source: "" });
    expect(e).toEqual({ symbol: "xauusd", side: "BUY", market: false, entryLow: 4075, entryHigh: 4080, stop: 4063, targets: [4100], source: null });
  });
});
