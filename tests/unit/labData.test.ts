import { describe, it, expect } from "vitest";
import { makeBars } from "@/lib/lab/bars";
import { decodeSeries, encodeSeries, LabDataError } from "@/lib/lab/data/encode";
import { parseMt5Csv } from "@/lib/lab/data/mt5csv";

const bars = makeBars([[1_000, 1, 2, 0.5, 1.5], [61_000, 1.5, 2.5, 1, 2], [121_000, 2, 3, 1.5, 2.5]]);

describe("lab data — encode", () => {
  it("round-trips bars with and without a spread column", () => {
    const a = decodeSeries(encodeSeries(bars));
    expect(Array.from(a.bars.c)).toEqual([1.5, 2, 2.5]);
    expect(a.spread).toBeNull();
    const b = decodeSeries(encodeSeries(bars, Float64Array.from([0.2, 0.3, 0.25])));
    expect(Array.from(b.spread!)).toEqual([0.2, 0.3, 0.25]);
    expect(Array.from(b.bars.t)).toEqual([1_000, 61_000, 121_000]);
  });
  it("compresses a flat series", () => {
    const flat = makeBars(Array.from({ length: 5_000 }, (_, i) => [i * 60_000, 100, 100, 100, 100] as const));
    expect(encodeSeries(flat).length).toBeLessThan(5_000 * 5 * 8 / 4);
  });
  it("rejects a corrupt buffer", () => {
    expect(() => decodeSeries(Buffer.from("not gzip"))).toThrow(LabDataError);
  });
});

const header = "utc,open,high,low,close,spread_points,point,symbol=XAUUSD.ec";
describe("lab data — MT5 ExportM1 CSV", () => {
  it("parses rows, the symbol and the spread in price units", () => {
    const r = parseMt5Csv([header, "1760374620,4108.92,4108.92,4107.09,4107.51,18,0.01", "1760374680,4107.5,4108,4107,4107.8,20,0.01", ""].join("\n"));
    expect(r.symbol).toBe("XAUUSD.ec");
    expect(Array.from(r.bars.t)).toEqual([1760374620_000, 1760374680_000]);
    expect(Array.from(r.spread)).toEqual([0.18, 0.2]);
    expect(r.bars.h[0]).toBe(4108.92);
  });
  it("drops duplicate times and rejects time going backwards with the line number", () => {
    const dup = parseMt5Csv([header, "100,1,1,1,1,1,0.01", "100,1,1,1,1,1,0.01", "160,1,1,1,1,1,0.01"].join("\n"));
    expect(dup.bars.t.length).toBe(2);
    expect(() => parseMt5Csv([header, "200,1,1,1,1,1,0.01", "100,1,1,1,1,1,0.01"].join("\n"))).toThrow(/line 3/);
  });
  it("rejects another file format and non-numeric rows", () => {
    expect(() => parseMt5Csv("date,price\n1,2")).toThrow(/ExportM1/);
    expect(() => parseMt5Csv([header, "100,abc,1,1,1,1,0.01"].join("\n"))).toThrow(/line 2/);
  });
});
