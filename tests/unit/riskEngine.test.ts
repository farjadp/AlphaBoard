import { describe, it, expect } from "vitest";
import { parseMandate } from "@/lib/sessions/mandate";
import { evaluateProposal, type MarketRules, type Proposal, type RiskState } from "@/lib/risk/verdict";
import { floorToStep } from "@/lib/risk/limits";

const NOW = 1_700_000_000_000;
const spot = parseMandate({ symbols: ["BTC/USDT", "ETH/USDT"], capital: 1_000 });
const swap = parseMandate({ symbols: ["BTC/USDT", "ETH/USDT"], capital: 1_000, marketType: "swap", maxLeverage: 5 });

const state = (o: Partial<RiskState> = {}): RiskState => ({
  equity: 1_000, freeCapital: 1_000, openPositions: [], tradesCount: 0, lastStopOutAt: {}, now: NOW,
  dailyLossUsed: 0, dailyLossLimit: null, sessionLoss: 0, ...o,
});
const rules = (o: Partial<MarketRules> = {}): MarketRules => ({ price: 100, minQty: 0.001, minCost: 5, qtyStep: 0.001, feeRate: 0.0005, slippage: 0.0005, ...o });
const long = (o: Partial<Proposal> = {}): Proposal => ({
  action: "OPEN_LONG", symbol: "BTC/USDT", conviction: 0.7, thesis: "trend up", positionId: null,
  exitPlan: { stopLoss: 95, takeProfit: 110, invalidation: "close below 94", horizonMin: 240 }, ...o,
});
const reasons = (v: { reasons: string[] }) => v.reasons.join(" | ");

describe("risk engine — sizing", () => {
  it("sizes from risk per trade and stop distance", () => {
    // risk 1% of 1000 = $10; stop distance $5 → 2 units; cap = 50% of capital = $500 → 5 units. 2 < 5.
    const v = evaluateProposal(long(), spot, state(), rules());
    expect(v).toMatchObject({ kind: "approved", side: "LONG", qty: 2, leverage: 1, margin: 200, stopLoss: 95, takeProfit: 110 });
  });

  it("clamps to the max position size and says so", () => {
    const v = evaluateProposal(long({ exitPlan: { stopLoss: 99.5, takeProfit: 110, invalidation: "", horizonMin: 60 } }), spot, state(), rules());
    // qtyRisk = 10 / 0.5 = 20; cap = 500 / 100 = 5
    expect(v).toMatchObject({ kind: "clamped", qty: 5, margin: 500 });
    expect(reasons(v)).toMatch(/clamped/);
  });

  it("uses the mandate leverage on swap and caps by free capital (after fee + slippage)", () => {
    const v = evaluateProposal(long({ exitPlan: { stopLoss: 99.5, takeProfit: 110, invalidation: "", horizonMin: 60 } }), swap, state({ freeCapital: 300 }), rules());
    // ≈ min(300 / (1 + 5 × 0.0005) / 1.0005, 500) × 5 / 100 ≈ 14.95 units (risk size 20 → clamped)
    expect(v).toMatchObject({ kind: "clamped", leverage: 5 });
    if (v.kind !== "clamped") return;
    expect(v.qty).toBeGreaterThan(14.9);
    expect(v.qty).toBeLessThan(15);
    expect(v.margin * (1 + 5 * 0.0005) * 1.0005).toBeLessThanOrEqual(300);
  });

  it("leaves room for the entry fee and slippage when free capital is the binding cap", () => {
    const v = evaluateProposal(long({ exitPlan: { stopLoss: 99.5, takeProfit: 110, invalidation: "", horizonMin: 60 } }), spot, state({ freeCapital: 49.95 }), rules());
    expect(v.kind).toBe("clamped");
    if (v.kind !== "clamped") return;
    const fill = 100 * (1 + 0.0005);
    expect(v.qty * fill * (1 + 0.0005)).toBeLessThanOrEqual(49.95);
  });

  it("sizes in the account currency when the quote currency differs", () => {
    // $10 risk over a $5 stop at 1.25 CAD per USD → 1.6 units; margin in CAD
    const v = evaluateProposal(long(), spot, state(), rules({ quoteToAccount: 1.25 }));
    expect(v).toMatchObject({ kind: "approved", qty: 1.6 });
    if (v.kind === "approved") expect(v.margin).toBeCloseTo(1.6 * 100 * 1.25, 8);
  });

  it("floors to the venue step", () => {
    expect(floorToStep(1.23456, 0.001)).toBeCloseTo(1.234, 12);
    expect(floorToStep(0.3, 0.1)).toBeCloseTo(0.3, 12);
    expect(floorToStep(5, 1)).toBe(5);
  });
});

describe("risk engine — rejections", () => {
  it("hold is not a trade", () => {
    expect(evaluateProposal(long({ action: "HOLD" }), spot, state(), rules()).kind).toBe("hold");
  });
  it("symbol outside the allowlist", () => {
    expect(reasons(evaluateProposal(long({ symbol: "SOL/USDT" }), spot, state(), rules()))).toMatch(/allowlist/);
  });
  it("no live price", () => {
    expect(reasons(evaluateProposal(long(), spot, state(), null))).toMatch(/price unavailable/);
  });
  it("short on spot", () => {
    const v = evaluateProposal(long({ action: "OPEN_SHORT", exitPlan: { stopLoss: 105, takeProfit: 90, invalidation: "", horizonMin: 60 } }), spot, state(), rules());
    expect(v.kind).toBe("rejected");
    expect(reasons(v)).toMatch(/spot/);
  });
  it("session loss limit, daily loss limit, max trades, max open positions, duplicate symbol, cooldown", () => {
    expect(reasons(evaluateProposal(long(), spot, state({ sessionLoss: 100 }), rules()))).toMatch(/loss limit/);
    expect(reasons(evaluateProposal(long(), spot, state({ dailyLossUsed: 50, dailyLossLimit: 50 }), rules()))).toMatch(/daily/);
    expect(reasons(evaluateProposal(long(), spot, state({ tradesCount: 6 }), rules()))).toMatch(/trades/);
    const open = (symbol: string) => ({ id: symbol, symbol, side: "LONG" as const, qty: 1, entryPrice: 100, stopLoss: 90, margin: 100 });
    expect(reasons(evaluateProposal(long({ symbol: "ETH/USDT" }), spot, state({ openPositions: [open("BTC/USDT"), open("SOL/USDT")] }), rules()))).toMatch(/open positions/);
    expect(reasons(evaluateProposal(long(), spot, state({ openPositions: [open("BTC/USDT")] }), rules()))).toMatch(/already/);
    expect(reasons(evaluateProposal(long(), spot, state({ lastStopOutAt: { "BTC/USDT": NOW - 10 * 60_000 } }), rules()))).toMatch(/cooldown/);
    expect(evaluateProposal(long(), spot, state({ lastStopOutAt: { "BTC/USDT": NOW - 31 * 60_000 } }), rules()).kind).toBe("approved");
  });
  it("stop missing or on the wrong side", () => {
    expect(reasons(evaluateProposal(long({ exitPlan: { stopLoss: null, takeProfit: 110, invalidation: "", horizonMin: 60 } }), spot, state(), rules()))).toMatch(/stop/);
    expect(reasons(evaluateProposal(long({ exitPlan: { stopLoss: 101, takeProfit: 110, invalidation: "", horizonMin: 60 } }), spot, state(), rules()))).toMatch(/stop/);
  });
  it("drops a take-profit on the wrong side but keeps the trade", () => {
    const v = evaluateProposal(long({ exitPlan: { stopLoss: 95, takeProfit: 99, invalidation: "", horizonMin: 60 } }), spot, state(), rules());
    expect(v).toMatchObject({ kind: "approved", takeProfit: null });
    expect(reasons(v)).toMatch(/take-profit/);
  });
  it("below the venue minimum", () => {
    const v = evaluateProposal(long(), spot, state({ equity: 10, freeCapital: 10 }), rules({ minCost: 5 }));
    // risk $0.10 / $5 = 0.02 units = $2 < $5 min cost
    expect(reasons(v)).toMatch(/minimum/);
  });
  it("target too close to pay the fees", () => {
    const v = evaluateProposal(long({ exitPlan: { stopLoss: 95, takeProfit: 100.2, invalidation: "", horizonMin: 60 } }), spot, state(), rules());
    expect(v.kind).toBe("rejected");
    expect(reasons(v)).toMatch(/fees/);
  });
  it("stop beyond the liquidation price on leverage", () => {
    const m = parseMandate({ symbols: ["BTC/USDT"], capital: 1_000, marketType: "swap", maxLeverage: 20 });
    // liquidation for 20x long at 100 ≈ 95; a stop at 94 would be liquidated first
    const v = evaluateProposal(long({ exitPlan: { stopLoss: 94, takeProfit: 120, invalidation: "", horizonMin: 60 } }), m, state(), rules());
    expect(reasons(v)).toMatch(/liquidation/);
  });
});

describe("risk engine — managing open positions", () => {
  const pos = { id: "p1", symbol: "BTC/USDT", side: "LONG" as const, qty: 1, entryPrice: 90, stopLoss: 85, margin: 90 };
  it("close resolves the position by id or by symbol", () => {
    expect(evaluateProposal(long({ action: "CLOSE", positionId: "p1" }), spot, state({ openPositions: [pos] }), rules())).toMatchObject({ kind: "close", positionId: "p1" });
    expect(evaluateProposal(long({ action: "CLOSE" }), spot, state({ openPositions: [pos] }), rules())).toMatchObject({ kind: "close", positionId: "p1" });
    expect(evaluateProposal(long({ action: "CLOSE", symbol: "ETH/USDT" }), spot, state({ openPositions: [pos] }), rules()).kind).toBe("rejected");
  });
  it("tighten only moves the stop toward the price", () => {
    const at = (stopLoss: number) => long({ action: "TIGHTEN_STOP", positionId: "p1", exitPlan: { stopLoss, takeProfit: null, invalidation: "", horizonMin: 60 } });
    expect(evaluateProposal(at(92), spot, state({ openPositions: [pos] }), rules())).toMatchObject({ kind: "tighten", stopLoss: 92 });
    expect(evaluateProposal(at(80), spot, state({ openPositions: [pos] }), rules()).kind).toBe("rejected");
    expect(evaluateProposal(at(101), spot, state({ openPositions: [pos] }), rules()).kind).toBe("rejected");
  });
  it("close and tighten still work after the loss limit or trade cap (exits are never blocked)", () => {
    expect(evaluateProposal(long({ action: "CLOSE", positionId: "p1" }), spot, state({ openPositions: [pos], sessionLoss: 500, tradesCount: 99 }), rules()).kind).toBe("close");
  });
});
