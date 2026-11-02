import { describe, expect, it } from "vitest";
import { ANALYST_EXTRACT_JSON, AnalystExtractFields, AnalystExtractSchema, catalogSymbolOf, draftFromExtract, westernDigits } from "@/lib/analyst/extract";

const NOW = new Date("2026-11-01T23:00:00Z"); // Sunday evening, Toronto

// Shaped like the 2026-11-01 summary of Nima Razzaghi's weekly video.
const raw = {
  source: "Nima Razzaghi",
  title: "Week of Nov 2–6",
  refPrices: [{ symbol: "XAUUSD", price: 3875 }, { symbol: "DXY", price: 101.7 }],
  events: [{ at: "2026-11-06T13:30:00Z", label: "NFP" }, { at: "next week sometime", label: "Fed talk" }],
  zones: [
    { symbol: "طلا", kind: "SELL", low: 3976, high: 3940, direction: null, closeTf: null, condition: null, note: "fib 38–50%", uncertain: false },
    { symbol: "XAUUSD", kind: "BUY", low: 3850, high: 3865, direction: null, closeTf: null, condition: "only with a lower-timeframe trigger", note: null, uncertain: true },
    { symbol: "XAUUSD", kind: "TARGET", low: 3740, high: 3760, direction: null, closeTf: null, condition: null, note: null, uncertain: false },
    { symbol: "XAUUSD", kind: "INVALIDATION", low: 3976, high: 3976, direction: "ABOVE", closeTf: "4H", condition: null, note: null, uncertain: false },
    { symbol: "EURUSD", kind: "TARGET", low: 12400, high: 12500, direction: null, closeTf: null, condition: null, note: null, uncertain: true },
    { symbol: "Binance coin index", kind: "BUY", low: 1, high: 2, direction: null, closeTf: null, condition: null, note: null, uncertain: false },
    { symbol: "داوجونز", kind: "BUY", low: 51300, high: 51500, direction: null, closeTf: null, condition: null, note: null, uncertain: false },
    { symbol: "DXY", kind: "INVALIDATION", low: 102.2, high: 102.2, direction: "sideways", closeTf: "4H", condition: null, note: null, uncertain: false },
  ],
};

describe("catalogSymbolOf", () => {
  it("maps common spellings, Persian names and CFD tickers to catalog symbols", () => {
    expect(catalogSymbolOf("GOLD")).toBe("XAU/USD");
    expect(catalogSymbolOf("طلا")).toBe("XAU/USD");
    expect(catalogSymbolOf("XAUUSD.ec")).toBe("XAU/USD");
    expect(catalogSymbolOf("US30")).toBe("DJI");
    expect(catalogSymbolOf("Dow Jones")).toBe("DJI");
    expect(catalogSymbolOf("بیت‌کوین")).toBe("BTC/USDT");
    expect(catalogSymbolOf("Dollar index")).toBe("DXY");
    expect(catalogSymbolOf("GBP/USD")).toBe("GBP/USD");
    expect(catalogSymbolOf("یورو/دلار")).toBe("EUR/USD");
    expect(catalogSymbolOf("Binance coin index")).toBeNull();
  });
});

describe("draftFromExtract", () => {
  const d = draftFromExtract(AnalystExtractSchema.parse(raw), NOW);

  it("keeps source and title, maps symbols, swaps reversed ranges", () => {
    expect(d.source).toBe("Nima Razzaghi");
    expect(d.title).toBe("Week of Nov 2–6");
    expect(d.zones[0]).toMatchObject({ symbol: "XAU/USD", kind: "SELL", low: 3940, high: 3976, note: "fib 38–50%", uncertain: false });
    expect(d.zones.find((z) => z.symbol === "DJI")).toMatchObject({ kind: "BUY", low: 51300, high: 51500 });
  });

  it("keeps the model's doubt and flags numbers far from the reference price", () => {
    expect(d.zones[1]).toMatchObject({ kind: "BUY", uncertain: true, condition: "only with a lower-timeframe trigger" });
    const eur = d.zones.find((z) => z.symbol === "EUR/USD");
    expect(eur).toMatchObject({ uncertain: true });
    expect(d.refPrices).toEqual({ "XAU/USD": 3875, DXY: 101.7 });
    // 3740 is 3.5% from 3875: fine.
    expect(d.zones.find((z) => z.kind === "TARGET" && z.symbol === "XAU/USD")?.uncertain).toBe(false);
  });

  it("flags a zone far from the reference price even when the model was sure", () => {
    const far = draftFromExtract(AnalystExtractSchema.parse({ ...raw, zones: [{ ...raw.zones[2], low: 2900, high: 3100 }] }), NOW);
    expect(far.zones[0].uncertain).toBe(true);
    expect(far.warnings.join(" ")).toMatch(/XAU\/USD.*far from/);
  });

  it("drops unknown symbols and bad events with a warning", () => {
    expect(d.zones.some((z) => z.symbol.includes("Binance"))).toBe(false);
    expect(d.warnings.join(" ")).toMatch(/Binance coin index/);
    expect(d.events).toEqual([{ at: "2026-11-06T13:30:00.000Z", label: "NFP" }]);
    expect(d.warnings.join(" ")).toMatch(/Fed talk/);
  });

  it("keeps invalidation direction only when it is ABOVE or BELOW, defaulting the timeframe to 4H", () => {
    const xau = d.zones.find((z) => z.kind === "INVALIDATION" && z.symbol === "XAU/USD");
    expect(xau).toMatchObject({ direction: "ABOVE", closeTf: "4H", low: 3976, high: 3976 });
    const dxy = d.zones.find((z) => z.symbol === "DXY");
    expect(dxy).toMatchObject({ kind: "INFO", direction: null });
    expect(d.warnings.join(" ")).toMatch(/DXY.*direction/);
  });

  it("sets the default expiry to the next Saturday 00:00 UTC", () => {
    expect(d.expiresAt).toBe("2026-11-07T00:00:00.000Z");
  });

  it("survives junk from the model", () => {
    const j = draftFromExtract(AnalystExtractSchema.parse({ zones: [{ symbol: "XAUUSD", kind: "MAYBE", low: "abc", high: -1 }, null], events: "x" }), NOW);
    expect(j.zones).toEqual([]);
    expect(j.source).toBeNull();
  });
});

describe("loose model output (OpenAI json_object mode has no schema)", () => {
  it("reads Persian digits, kind words, other key names and list names", () => {
    const d = draftFromExtract(AnalystExtractSchema.parse({
      source: "نیما رزاقی",
      levels: [
        { symbol: "طلا", kind: "SELL", low: "۳۹۴۰", high: "۳۹۷۶" },
        { symbol: "XAUUSD", kind: "فروش", low: 3940, high: 3976 },
        { instrument: "XAUUSD", type: "buy zone", from: "3,850", to: "3,865", uncertain: "true" },
        { symbol: "XAUUSD", kind: "target", price: 3740 },
        { symbol: "XAUUSD", kind: "ابطال", price: 3976, direction: "close above", closeTf: "4h" },
        { symbol: "GBPUSD", kind: "BUY", low: "۱٫۳۳۴۰", high: "1.3360" },
      ],
    }), NOW);
    expect(d.zones.map((z) => [z.symbol, z.kind, z.low, z.high])).toEqual([
      ["XAU/USD", "SELL", 3940, 3976],
      ["XAU/USD", "SELL", 3940, 3976],
      ["XAU/USD", "BUY", 3850, 3865],
      ["XAU/USD", "TARGET", 3740, 3740],
      ["XAU/USD", "INVALIDATION", 3976, 3976],
      ["GBP/USD", "BUY", 1.334, 1.336],
    ]);
    expect(d.zones[2].uncertain).toBe(true);
    expect(d.zones[4]).toMatchObject({ direction: "ABOVE", closeTf: "4H" });
    expect(d.warnings).toEqual([]);
  });

  it("never drops a zone without saying why", () => {
    const d = draftFromExtract(AnalystExtractSchema.parse({ zones: [{ symbol: "XAUUSD", kind: "maybe", low: 1, high: 2 }, { kind: "BUY", low: 1 }, { symbol: "XAUUSD", kind: "BUY" }] }), NOW);
    expect(d.zones).toEqual([]);
    expect(d.warnings).toEqual([
      'Zone 1 (XAUUSD) was left out: unknown kind "maybe"',
      "Zone 2 was left out: no symbol",
      "Zone 3 (XAUUSD) was left out: no usable price",
      "None of the 3 zones the model returned could be read",
    ]);
    expect(draftFromExtract(AnalystExtractSchema.parse({ zones: [] }), NOW).warnings.join(" ")).toMatch(/found no zones/);
  });

  it("converts Persian and Arabic-Indic digits in text", () => {
    expect(westernDigits("طلا ۳۸۶۵ تا ۳۸۵۰، پوند ۱٫۳۴۱۷ و ٤٢٠٠٬٥")).toBe("طلا 3865 تا 3850، پوند 1.3417 و 4200,5");
  });
});

describe("ANALYST_EXTRACT_JSON", () => {
  it("names every key the zod schema reads", () => {
    expect(Object.keys(ANALYST_EXTRACT_JSON.properties).sort()).toEqual(Object.keys(AnalystExtractFields.shape).sort());
    expect(ANALYST_EXTRACT_JSON.required.slice().sort()).toEqual(Object.keys(ANALYST_EXTRACT_JSON.properties).sort());
  });
});
