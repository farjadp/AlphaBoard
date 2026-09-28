import { describe, it, expect } from "vitest";
import { parseBinanceFutures, parseBybitFutures, parseOkxFutures, futuresSymbolCandidates } from "@/lib/market/futures";

describe("futures payload parsers", () => {
  it("normalizes Binance premiumIndex + openInterest + long/short ratio", () => {
    const out = parseBinanceFutures(
      { markPrice: "83079.8", lastFundingRate: "0.00006409", time: 1790609583374 },
      { openInterest: "94945.400" },
      [{ longAccount: "0.5742", shortAccount: "0.4258", longShortRatio: "1.3485", timestamp: 1790609400000 }],
    );
    expect(out.source).toBe("binance");
    expect(out.fundingRatePct).toBeCloseTo(0.006409, 6);
    expect(out.openInterestUsd).toBeCloseTo(94945.4 * 83079.8, 0);
    expect(out.longPct).toBeCloseTo(57.42, 2);
    expect(out.shortPct).toBeCloseTo(42.58, 2);
  });

  it("normalizes Bybit tickers + account-ratio", () => {
    const out = parseBybitFutures(
      { retCode: 0, result: { list: [{ fundingRate: "0.0001", openInterestValue: "5000000000", markPrice: "83090" }] } },
      { retCode: 0, result: { list: [{ buyRatio: "0.5778", sellRatio: "0.4222", timestamp: "1790609400000" }] } },
    );
    expect(out.source).toBe("bybit");
    expect(out.fundingRatePct).toBeCloseTo(0.01, 6);
    expect(out.openInterestUsd).toBe(5_000_000_000);
    expect(out.longPct).toBeCloseTo(57.78, 2);
  });

  it("normalizes OKX funding + OI + ratio (ratio → percentages)", () => {
    const out = parseOkxFutures(
      { code: "0", data: [{ fundingRate: "0.0000703" }] },
      { code: "0", data: [{ oiUsd: "2405165137.57" }] },
      { code: "0", data: [["1790609400000", "1.35"]] },
    );
    expect(out.source).toBe("okx");
    expect(out.openInterestUsd).toBeCloseTo(2405165137.57, 1);
    expect(out.longPct).toBeCloseTo((1.35 / 2.35) * 100, 4);
  });

  it("throws on provider error envelopes so the chain falls through", () => {
    expect(() => parseBybitFutures({ retCode: 10001, result: { list: [] } }, null)).toThrow();
    expect(() => parseOkxFutures({ code: "51001", data: [] }, null, null)).toThrow();
  });

  it("tries the 1000x contract for low-priced coins", () => {
    expect(futuresSymbolCandidates("PEPEUSDT")).toEqual(["PEPEUSDT", "1000PEPEUSDT"]);
  });
});
