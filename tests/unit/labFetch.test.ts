import { describe, it, expect } from "vitest";
import { fetchBinanceHistory } from "@/lib/lab/data/binance";
import { fetchOandaHistory } from "@/lib/lab/data/oanda";

const MIN = 60_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("lab data — Binance history", () => {
  /** A server with one kline per minute from t=0 to t=2499 min, max 1000 per call. */
  const server = (calls: string[]) => async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const start = Number(u.searchParams.get("startTime"));
    const end = Number(u.searchParams.get("endTime"));
    const rows = [];
    for (let t = Math.ceil(start / MIN) * MIN; t <= end && t < 2500 * MIN && rows.length < 1000; t += MIN) rows.push([t, "1", "2", "0.5", "1.5", "0"]);
    return json(rows);
  };

  it("pages until the range is covered, without duplicates", async () => {
    const calls: string[] = [];
    const r = await fetchBinanceHistory({ symbol: "BTCUSDT", interval: "1m", from: 0, to: 2499 * MIN }, { fetch: server(calls), sleep: async () => {} });
    expect(r.bars.t.length).toBe(2500);
    expect(calls.length).toBe(3);
    for (let i = 1; i < r.bars.t.length; i++) expect(r.bars.t[i] - r.bars.t[i - 1]).toBe(MIN);
    expect(calls[0]).toMatch(/symbol=BTCUSDT&interval=1m/);
  });

  it("stops early when the provider has no more bars, and reports the real range", async () => {
    const r = await fetchBinanceHistory({ symbol: "BTCUSDT", interval: "1m", from: 0, to: 9_999 * MIN }, { fetch: server([]), sleep: async () => {} });
    expect(r.bars.t.length).toBe(2500);
    expect(r.to).toBe(2499 * MIN);
  });

  it("errors on an HTTP failure or an empty first page", async () => {
    await expect(fetchBinanceHistory({ symbol: "X", interval: "1m", from: 0, to: MIN }, { fetch: async () => json({ msg: "bad" }, 400), sleep: async () => {} })).rejects.toThrow(/Binance/);
    await expect(fetchBinanceHistory({ symbol: "X", interval: "1m", from: 0, to: MIN }, { fetch: async () => json([]), sleep: async () => {} })).rejects.toThrow(/no bars/);
  });
});

describe("lab data — OANDA history", () => {
  const conn = { sandbox: false, apiKeyEnc: "enc" };
  const unix = (ms: number) => (ms / 1000).toFixed(9);
  const server = (calls: Array<{ url: string; auth: string | null; fmt: string | null }>, total = 12_000) => async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    calls.push({ url, auth: h.get("Authorization"), fmt: h.get("Accept-Datetime-Format") });
    const u = new URL(url);
    const from = Number(u.searchParams.get("from")) * 1000;
    const count = Number(u.searchParams.get("count"));
    const candles = [];
    for (let k = 1; k <= count; k++) {
      const t = from + k * MIN; // includeFirst=false
      if (t >= total * MIN) break;
      candles.push({ time: unix(t), complete: t < (total - 1) * MIN, bid: { o: "1.0", h: "1.2", l: "0.9", c: "1.1" }, ask: { o: "1.2", h: "1.4", l: "1.1", c: "1.3" } });
    }
    return json({ instrument: "XAU_USD", granularity: "M1", candles });
  };

  it("pages bid/ask candles into mid prices with the real spread, complete candles only", async () => {
    const calls: Array<{ url: string; auth: string | null; fmt: string | null }> = [];
    const r = await fetchOandaHistory({ conn, instrument: "XAU_USD", granularity: "M1", from: 0, to: 20_000 * MIN }, { fetch: server(calls), decrypt: () => "tok", sleep: async () => {} });
    expect(calls[0].url).toMatch(/^https:\/\/api-fxtrade\.oanda\.com\/v3\/instruments\/XAU_USD\/candles\?/);
    expect(calls[0].url).toMatch(/price=BA/);
    expect(calls[0].auth).toBe("Bearer tok");
    expect(calls[0].fmt).toBe("UNIX");
    expect(r.bars.t.length).toBe(11_998); // minutes 1 … 11 998 complete; minute 11 999 is still forming
    expect(r.bars.o[0]).toBeCloseTo(1.1, 12);
    expect(r.bars.c[0]).toBeCloseTo(1.2, 12);
    expect(r.spread[0]).toBeCloseTo(0.2, 12);
  });

  it("uses the practice host for a sandbox connection and surfaces OANDA's error", async () => {
    const calls: Array<{ url: string; auth: string | null; fmt: string | null }> = [];
    await fetchOandaHistory({ conn: { sandbox: true, apiKeyEnc: "e" }, instrument: "EUR_USD", granularity: "M15", from: 0, to: 100 * MIN }, { fetch: server(calls, 50), decrypt: () => "t", sleep: async () => {} });
    expect(calls[0].url).toMatch(/api-fxpractice/);
    await expect(fetchOandaHistory({ conn, instrument: "NOPE", granularity: "M1", from: 0, to: MIN }, { fetch: async () => json({ errorMessage: "Invalid value specified for 'instrument'" }, 400), decrypt: () => "t", sleep: async () => {} }))
      .rejects.toThrow(/Invalid value specified/);
  });
});
