import { describe, it, expect } from "vitest";
import { parseDealsCsv, positionsFromDeals } from "@/lib/mt5/deals";

const H = "deal,order,position,time_utc,type,entry,symbol,volume,price,sl,tp,commission,swap,profit,fee,magic,comment,login=22215882,currency=USD";
// deal,order,position,time,type(0 buy/1 sell),entry(0 in/1 out/2 inout),symbol,volume,price,sl,tp,commission,swap,profit,fee,magic,comment
const row = (d: number, pos: number, t: number, type: 0 | 1, entry: 0 | 1 | 2, vol: number, price: number, o: Partial<{ sl: number; comm: number; swap: number; profit: number; magic: number }> = {}) =>
  [d, d, pos, t, type, entry, "XAUUSD.ec", vol, price, o.sl ?? 0, 0, o.comm ?? 0, o.swap ?? 0, o.profit ?? 0, 0, o.magic ?? 0, "c"].join(",");

describe("MT5 ExportDeals", () => {
  it("reads the header (login, currency) and the rows", () => {
    const r = parseDealsCsv([H, row(1, 10, 1_760_000_000, 0, 0, 0.02, 4100, { sl: 4087 })].join("\n"));
    expect(r).toMatchObject({ login: "22215882", currency: "USD" });
    expect(r.deals[0]).toMatchObject({ deal: 1, position: 10, time: 1_760_000_000_000, side: "BUY", entry: "IN", symbol: "XAUUSD.ec", volume: 0.02, price: 4100, sl: 4087 });
  });

  it("rejects another file", () => {
    expect(() => parseDealsCsv("a,b\n1,2")).toThrow(/ExportDeals/);
  });

  it("rebuilds a round trip, summing profit, swap, commission and fee", () => {
    const { deals } = parseDealsCsv([H,
      row(1, 10, 1000, 0, 0, 0.02, 4100, { sl: 4087, comm: -0.14 }),
      row(2, 10, 4600, 1, 1, 0.02, 4110, { comm: -0.14, swap: -0.05, profit: 20 }),
    ].join("\n"));
    const [p] = positionsFromDeals(deals);
    expect(p).toMatchObject({ position: 10, side: "LONG", symbol: "XAUUSD.ec", volume: 0.02, entryPrice: 4100, exitPrice: 4110, initialStop: 4087, openedAt: 1_000_000, closedAt: 4_600_000, closed: true, manual: true });
    expect(p.net).toBeCloseTo(20 - 0.28 - 0.05, 9);
  });

  it("partial closes: volume-weighted exit price, closed only when the volume is gone", () => {
    const { deals } = parseDealsCsv([H,
      row(1, 11, 1000, 1, 0, 0.04, 4100, { magic: 880801 }),
      row(2, 11, 2000, 0, 1, 0.03, 4090, { profit: 30 }),
      row(3, 11, 3000, 0, 1, 0.01, 4096, { profit: 4 }),
      row(4, 12, 5000, 0, 0, 0.01, 4000),
    ].join("\n"));
    const ps = positionsFromDeals(deals);
    const p11 = ps.find((p) => p.position === 11)!;
    expect(p11).toMatchObject({ side: "SHORT", closed: true, manual: false, magic: 880801, closedAt: 3_000_000 });
    expect(p11.exitPrice).toBeCloseTo((0.03 * 4090 + 0.01 * 4096) / 0.04, 9);
    expect(p11.net).toBeCloseTo(34, 9);
    expect(ps.find((p) => p.position === 12)!.closed).toBe(false);
  });
});
