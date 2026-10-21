import { describe, it, expect } from "vitest";
import { encodeJobs, parseReport } from "@/lib/signals/wire";

const form = (s: string) => new URLSearchParams(s);

describe("encodeJobs", () => {
  it("writes an OPEN line with every field", () => {
    expect(encodeJobs([{ kind: "OPEN", id: "s1", symbol: "XAUUSD.ec", side: "BUY", entry: 2650.4, stop: 2638, maxDeviation: null, riskPct: 0.5, tps: [2656, 2662] }]))
      .toBe("OPEN|s1|XAUUSD.ec|BUY|2650.4|2638|-|0.5|2656,2662");
  });
  it("writes - for a market entry and no TPs", () => {
    expect(encodeJobs([{ kind: "OPEN", id: "s2", symbol: "SOLUSD.ec", side: "SELL", entry: null, stop: 190.5, maxDeviation: 1.2, riskPct: 1, tps: [] }]))
      .toBe("OPEN|s2|SOLUSD.ec|SELL|-|190.5|1.2|1|-");
  });
  it("writes a CMD line and joins jobs with newlines", () => {
    expect(encodeJobs([{ kind: "CMD", id: "s1", command: "BREAKEVEN" }, { kind: "CMD", id: "s3", command: "CLOSE_ALL" }]))
      .toBe("CMD|s1|BREAKEVEN\nCMD|s3|CLOSE_ALL");
  });
  it("prints numbers without float noise", () => {
    expect(encodeJobs([{ kind: "OPEN", id: "s", symbol: "X", side: "BUY", entry: 0.1 + 0.2, stop: 0.1, maxDeviation: null, riskPct: 0.5, tps: [] }]))
      .toBe("OPEN|s|X|BUY|0.3|0.1|-|0.5|-");
  });
  it("is empty when there is nothing to do", () => expect(encodeJobs([])).toBe(""));
  it("refuses a symbol that would break the line format", () => {
    expect(() => encodeJobs([{ kind: "OPEN", id: "s", symbol: "X|Y", side: "BUY", entry: null, stop: 1, maxDeviation: null, riskPct: 0.5, tps: [] }])).toThrow();
  });
});

describe("parseReport", () => {
  it("parses FILLED", () =>
    expect(parseReport(form("event=FILLED&leg=1&ticket=123&volume=0.02&price=2650.4&tp=2656")))
      .toEqual({ event: "FILLED", leg: 1, ticket: "123", volume: 0.02, price: 2650.4, tp: 2656 }));
  it("parses FILLED without a TP", () =>
    expect(parseReport(form("event=FILLED&leg=1&ticket=123&volume=0.02&price=2650.4"))).toMatchObject({ tp: null }));
  it("parses REJECTED and DRY_RUN", () => {
    expect(parseReport(form("event=REJECTED&reason=price%20moved"))).toEqual({ event: "REJECTED", reason: "price moved" });
    expect(parseReport(form("event=DRY_RUN&reason=lots%3D0.04%20legs%3D3"))).toEqual({ event: "DRY_RUN", reason: "lots=0.04 legs=3" });
  });
  it("parses TP, SL and CLOSED", () => {
    expect(parseReport(form("event=TP&leg=1&price=2656.0"))).toEqual({ event: "TP", leg: 1, price: 2656 });
    expect(parseReport(form("event=SL&leg=2&price=2638.0"))).toEqual({ event: "SL", leg: 2, price: 2638 });
    expect(parseReport(form("event=CLOSED&leg=3&price=2649.1"))).toEqual({ event: "CLOSED", leg: 3, price: 2649.1 });
  });
  it("parses BE", () => expect(parseReport(form("event=BE&price=2650.4"))).toEqual({ event: "BE", price: 2650.4 }));
  it("rejects bad input", () => {
    for (const bad of ["event=NOPE", "event=TP&leg=0&price=1", "event=TP&leg=1&price=abc", "event=TP&leg=1.5&price=1",
      "event=FILLED&leg=1&ticket=&volume=0.01&price=1", "event=FILLED&leg=1&ticket=1&volume=0&price=1", "event=REJECTED", "event=BE&price=-1"]) {
      expect(() => parseReport(form(bad)), bad).toThrow();
    }
  });
  it("accepts the bodies SignalCopier.mq5 builds (digits-padded prices, %-encoded reasons)", () => {
    expect(parseReport(form("event=FILLED&leg=2&ticket=4410293817&volume=0.02&price=2650.40&tp=2662.00")))
      .toEqual({ event: "FILLED", leg: 2, ticket: "4410293817", volume: 0.02, price: 2650.4, tp: 2662 });
    expect(parseReport(form("event=FILLED&leg=1&ticket=7&volume=0.010&price=180.215"))).toMatchObject({ volume: 0.01, tp: null });
    expect(parseReport(form("event=DRY_RUN&reason=lots%3D0.04%20legs%3D2%20price%3D2650.40%20stop%3D2638.00%20tp1%3D2656.00%20tp2%3D2662.00")))
      .toEqual({ event: "DRY_RUN", reason: "lots=0.04 legs=2 price=2650.40 stop=2638.00 tp1=2656.00 tp2=2662.00" });
    expect(parseReport(form("event=REJECTED&reason=leg%202%3A%20Invalid%20stops%20%2810016%29"))).toEqual({ event: "REJECTED", reason: "leg 2: Invalid stops (10016)" });
    expect(parseReport(form("event=BE&price=1"))).toEqual({ event: "BE", price: 1 });
    expect(parseReport(form("event=SL&leg=3&price=2638.00"))).toEqual({ event: "SL", leg: 3, price: 2638 });
  });
});
