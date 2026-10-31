import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { buildBasketSeries, listListedSymbols, monthsBetween, parseKlineCsv } from "@/lib/lab/data/binanceVision";

const H = 3_600_000;
function zipOf(text: string): Blob {
  const raw = Buffer.from(text); const data = deflateRawSync(raw); const name = "x.csv";
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26);
  return new Blob([Buffer.concat([h, Buffer.from(name), data])]);
}
const klines = (fromMs: number, hours: number, px: number, header = false) =>
  (header ? "open_time,open,high,low,close,volume\n" : "") + Array.from({ length: hours }, (_, k) => `${fromMs + k * H},${px},${px + 1},${px - 1},${px},1`).join("\n");

describe("binance vision", () => {
  it("months between two months, inclusive", () => {
    expect(monthsBetween("2021-11", "2022-02")).toEqual(["2021-11", "2021-12", "2022-01", "2022-02"]);
  });

  it("parses kline CSVs with or without a header, and microsecond times", () => {
    const a = parseKlineCsv(klines(Date.UTC(2021, 0, 1), 3, 10, true));
    expect(a.t).toEqual([Date.UTC(2021, 0, 1), Date.UTC(2021, 0, 1) + H, Date.UTC(2021, 0, 1) + 2 * H]);
    const us = parseKlineCsv(`${Date.UTC(2025, 0, 1) * 1000},1,2,0.5,1.5,9`);
    expect(us.t[0]).toBe(Date.UTC(2025, 0, 1));
    expect(us.c[0]).toBe(1.5);
  });

  it("lists USDT symbols across listing pages and keeps those with a file in the month", async () => {
    const page1 = `<ListBucketResult><IsTruncated>true</IsTruncated><NextMarker>data/futures/um/monthly/klines/BUSDT/</NextMarker><CommonPrefixes><Prefix>data/futures/um/monthly/klines/AUSDT/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>data/futures/um/monthly/klines/BUSDT/</Prefix></CommonPrefixes></ListBucketResult>`;
    const page2 = `<ListBucketResult><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>data/futures/um/monthly/klines/CUSDT/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>data/futures/um/monthly/klines/DBUSD/</Prefix></CommonPrefixes></ListBucketResult>`;
    const fetch = async (url: string, init?: RequestInit) => {
      if (url.includes("s3-ap-northeast-1")) return new Response(url.includes("marker=") ? page2 : page1);
      // HEAD for the month file: A and C exist, B does not
      expect(init?.method).toBe("HEAD");
      return new Response(null, { status: url.includes("/BUSDT/") ? 404 : 200 });
    };
    expect(await listListedSymbols("2022-01", { fetch })).toEqual(["AUSDT", "CUSDT"]);
  });

  it("builds per-symbol hourly series from monthly zips, skipping missing months", async () => {
    const jan = Date.UTC(2021, 0, 1), feb = Date.UTC(2021, 1, 1);
    const fetch = async (url: string) => {
      if (url.includes("AUSDT-1h-2021-01")) return new Response(zipOf(klines(jan, 5, 10)));
      if (url.includes("AUSDT-1h-2021-02")) return new Response(zipOf(klines(feb, 2, 11)));
      if (url.includes("BUSDT-1h-2021-02")) return new Response(zipOf(klines(feb, 3, 20, true)));
      return new Response("<Error/>", { status: 404 });
    };
    const r = await buildBasketSeries(["AUSDT", "BUSDT", "CUSDT"], "2021-01", "2021-02", { fetch, concurrency: 2 });
    expect(r.series.map((s) => s.symbol)).toEqual(["AUSDT", "BUSDT"]);
    expect(r.missingSymbols).toEqual(["CUSDT"]);
    const a = r.series[0];
    expect(a.startHour).toBe(jan / H);
    expect(a.c.length).toBe((feb - jan) / H + 2); // continuous hours from first to last bar, gaps as NaN
    expect(Number.isNaN(a.c[10])).toBe(true);
    expect(a.c[a.c.length - 1]).toBe(11);
    expect(r.series[1].startHour).toBe(feb / H);
  });
});
