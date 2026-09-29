import { describe, it, expect } from "vitest";
import {
  FEE_RATE, SLIPPAGE, applySlippage, closePosition, equityOf, liquidationPrice, markPosition, openPosition, scanExit,
  type OpenPositionState,
} from "@/lib/paper/engine";

const candle = (time: number, open: number, high: number, low: number, close: number) => ({ time, open, high, low, close });

describe("fills", () => {
  it("slips against the trader: buys higher, sells lower", () => {
    expect(applySlippage("BUY", 100)).toBeCloseTo(100 * (1 + SLIPPAGE), 10);
    expect(applySlippage("SELL", 100)).toBeCloseTo(100 * (1 - SLIPPAGE), 10);
  });
});

describe("openPosition", () => {
  it("sizes a leveraged long from margin, charges the taker fee, and debits margin + fee", () => {
    const o = openPosition({ side: "LONG", margin: 1_000, leverage: 5, price: 100, cash: 10_000 });
    const fill = 100 * (1 + SLIPPAGE);
    expect(o.fillPrice).toBeCloseTo(fill, 10);
    expect(o.qty).toBeCloseTo(5_000 / fill, 10);
    expect(o.fee).toBeCloseTo(5_000 * FEE_RATE, 10);
    expect(o.cashAfter).toBeCloseTo(10_000 - 1_000 - 2.5, 10);
  });
  it("fills a short on the bid", () => {
    expect(openPosition({ side: "SHORT", margin: 100, leverage: 1, price: 50, cash: 1_000 }).fillPrice).toBeCloseTo(50 * (1 - SLIPPAGE), 10);
  });
  it("rejects a ticket the cash cannot cover (margin + fee)", () => {
    expect(() => openPosition({ side: "LONG", margin: 1_000, leverage: 1, price: 10, cash: 1_000 })).toThrow(/cash/i);
  });
  it("rejects SL/TP on the wrong side of the fill", () => {
    expect(() => openPosition({ side: "LONG", margin: 100, leverage: 1, price: 100, cash: 1_000, stopLoss: 101 })).toThrow(/stop/i);
    expect(() => openPosition({ side: "LONG", margin: 100, leverage: 1, price: 100, cash: 1_000, takeProfit: 99 })).toThrow(/take/i);
    expect(() => openPosition({ side: "SHORT", margin: 100, leverage: 1, price: 100, cash: 1_000, stopLoss: 99 })).toThrow(/stop/i);
  });
});

const long: OpenPositionState = { side: "LONG", qty: 10, entryPrice: 100, leverage: 5, margin: 200, stopLoss: 95, takeProfit: 110 };
const short: OpenPositionState = { side: "SHORT", qty: 10, entryPrice: 100, leverage: 2, margin: 500, stopLoss: 104, takeProfit: 90 };

describe("closePosition", () => {
  it("settles a winning long: gross PnL on the slipped exit, exit fee, net realized PnL", () => {
    const c = closePosition(long, 110, 1);
    const exit = 110 * (1 - SLIPPAGE);
    expect(c.exitPrice).toBeCloseTo(exit, 10);
    expect(c.grossPnl).toBeCloseTo((exit - 100) * 10, 10);
    expect(c.exitFee).toBeCloseTo(exit * 10 * FEE_RATE, 10);
    expect(c.cashCredit).toBeCloseTo(200 + c.grossPnl - c.exitFee, 10);
    expect(c.realizedPnl).toBeCloseTo(c.grossPnl - c.exitFee - 1, 10); // entry fee = 1
  });
  it("settles a short: profit when price falls, buying back on the ask", () => {
    const c = closePosition(short, 90, 0);
    expect(c.exitPrice).toBeCloseTo(90 * (1 + SLIPPAGE), 10);
    expect(c.grossPnl).toBeCloseTo((100 - 90 * (1 + SLIPPAGE)) * 10, 10);
  });
  it("never credits less than zero: isolated margin caps the loss", () => {
    expect(closePosition(long, 50, 0).cashCredit).toBe(0);
  });
});

describe("liquidationPrice", () => {
  it("is where the loss equals the margin", () => {
    expect(liquidationPrice("LONG", 100, 5)).toBeCloseTo(80, 10);
    expect(liquidationPrice("SHORT", 100, 2)).toBeCloseTo(150, 10);
    expect(liquidationPrice("LONG", 100, 1)).toBe(0);
  });
});

describe("scanExit", () => {
  const opened = 1_000;
  it("returns nothing while price stays inside SL/TP", () => {
    expect(scanExit(long, [candle(2_000, 100, 105, 97, 101)], opened)).toBeNull();
  });
  it("hits take-profit on the candle high", () => {
    expect(scanExit(long, [candle(2_000, 100, 111, 99, 108)], opened)).toMatchObject({ reason: "TAKE_PROFIT", level: 110, at: 2_000 });
  });
  it("hits stop-loss on the candle low, filling at the level", () => {
    expect(scanExit(long, [candle(2_000, 100, 101, 94, 96)], opened)).toMatchObject({ reason: "STOP_LOSS", level: 95 });
  });
  it("fills a gap through the stop at the open (worse than the level)", () => {
    expect(scanExit(long, [candle(2_000, 92, 93, 90, 91)], opened)).toMatchObject({ reason: "STOP_LOSS", level: 92 });
  });
  it("assumes the stop when one candle spans both SL and TP", () => {
    expect(scanExit(long, [candle(2_000, 100, 112, 94, 100)], opened)?.reason).toBe("STOP_LOSS");
  });
  it("takes the first candle that triggers, in time order", () => {
    const r = scanExit(short, [candle(3_000, 95, 96, 89, 90), candle(2_000, 100, 105, 99, 103)], opened);
    expect(r).toMatchObject({ reason: "STOP_LOSS", at: 2_000 });
  });
  it("liquidates before a stop that sits beyond the liquidation price", () => {
    const risky = { ...long, stopLoss: 70 }; // liq at 80
    expect(scanExit(risky, [candle(2_000, 100, 100, 75, 76)], opened)).toMatchObject({ reason: "LIQUIDATION", level: 80 });
  });
  it("ignores candles that started before the position opened", () => {
    expect(scanExit(long, [candle(500, 100, 120, 80, 100)], opened)).toBeNull();
  });
  it("positions without SL/TP only exit on liquidation", () => {
    const bare = { ...long, stopLoss: null, takeProfit: null };
    expect(scanExit(bare, [candle(2_000, 100, 150, 85, 90)], opened)).toBeNull();
  });
});

describe("marks and equity", () => {
  it("marks unrealized PnL at the quote, capped at the margin", () => {
    expect(markPosition(long, 104)).toBeCloseTo(40, 10);
    expect(markPosition(short, 104)).toBeCloseTo(-40, 10);
    expect(markPosition(long, 10)).toBe(-200);
  });
  it("equity = cash + margin + unrealized for each open position; unknown when a mark is missing", () => {
    expect(equityOf(1_000, [{ margin: 200, unrealizedPnl: 40 }, { margin: 500, unrealizedPnl: -40 }])).toBeCloseTo(1_700, 10);
    expect(equityOf(1_000, [{ margin: 200, unrealizedPnl: null }])).toBeNull();
    expect(equityOf(1_000, [])).toBe(1_000);
  });
});
