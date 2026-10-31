import { describe, expect, it } from "vitest";
import { brokerTicker, canonicalTicker, matchBrokerSymbol, matchCatalogSymbol, stripBrokerSuffix } from "@/lib/market/symbols";

describe("market symbols", () => {
  it("strips broker suffixes", () => {
    expect(stripBrokerSuffix("XAUUSD.ec")).toBe("XAUUSD");
    expect(stripBrokerSuffix("XAUUSDm")).toBe("XAUUSD");
    expect(brokerTicker("EURUSD.pro")).toBe("EURUSD");
  });

  it("canonicalises what people write", () => {
    expect(canonicalTicker("XAU/USD")).toBe("XAUUSD");
    expect(canonicalTicker(" gold ")).toBe("XAUUSD");
    expect(canonicalTicker("ETHUSDT.P")).toBe("ETHUSDT");
    expect(canonicalTicker("BTCUSDT PERP")).toBe("BTCUSDT");
    expect(canonicalTicker("XAUUSDm")).toBe("XAUUSD");
    expect(canonicalTicker("")).toBe("");
  });

  it("matches a written symbol to a terminal symbol, USD and USDT alike", () => {
    const terminal = ["XAUUSD.ec", "EURUSD.ec", "BTCUSD.ec", "OPUSD.ec"];
    expect(matchBrokerSymbol("GOLD", terminal)).toBe("XAUUSD.ec");
    expect(matchBrokerSymbol("BTCUSDT", terminal)).toBe("BTCUSD.ec");
    expect(matchBrokerSymbol("OP", terminal)).toBe("OPUSD.ec");
    expect(matchBrokerSymbol("NAS100", terminal)).toBeNull();
  });

  it("matches to the catalog", () => {
    const catalog = [{ symbol: "XAU/USD" }, { symbol: "OP/USDT" }, { symbol: "EUR/USD" }];
    expect(matchCatalogSymbol("XAUUSD.ec", catalog)).toBe("XAU/USD");
    expect(matchCatalogSymbol("OP", catalog)).toBe("OP/USDT");
    expect(matchCatalogSymbol("OPUSD", catalog)).toBe("OP/USDT");
    expect(matchCatalogSymbol("GBPUSD", catalog)).toBeNull();
  });
});
