/**
 * A fake ccxt exchange for venue / reconciler tests: BTC/USDT spot, 0.1% fees, configurable failures, and
 * optional native stop-loss orders (they rest until `trigger()` fills them at the current price).
 */
import type { CcxtMarket, CcxtOrder, ExchangeLike } from "@/lib/venues/ccxtClient";

export const market: CcxtMarket = { symbol: "BTC/USDT", base: "BTC", quote: "USDT", active: true, taker: 0.001, limits: { amount: { min: 0.00001 }, cost: { min: 5 } }, precision: { amount: 0.00001 } };

export function fakeExchange(opts: { nativeStops?: boolean } = {}) {
  const state = {
    price: 100_000,
    mode: "fill" as "fill" | "timeout-found" | "timeout-missing" | "reject",
    orders: [] as Array<CcxtOrder & { stopLossPrice?: number }>,
    /** Market orders sent (stops excluded). */
    calls: 0,
    stopCalls: 0,
    balance: { BTC: 0, USDT: 1_000 },
  };
  const timeout = () => Object.assign(new Error("request timed out"), { name: "RequestTimeout" });

  const fill = (o: CcxtOrder & { stopLossPrice?: number }) => {
    const amount = o.amount ?? 0;
    Object.assign(o, {
      status: "closed", filled: amount, remaining: 0, average: state.price,
      fee: o.side === "buy" ? { cost: amount * 0.001, currency: "BTC" } : { cost: amount * state.price * 0.001, currency: "USDT" },
    });
    if (o.side === "buy") state.balance.BTC += amount - amount * 0.001;
    else state.balance.BTC -= amount;
  };

  const ex: ExchangeLike = {
    id: "fake", has: {},
    features: { spot: { createOrder: { stopLossPrice: !!opts.nativeStops } } },
    loadMarkets: async () => ({ "BTC/USDT": market }),
    fetchTicker: async () => ({ last: state.price }),
    fetchBalance: async () => ({ free: { ...state.balance }, total: { ...state.balance } }),
    amountToPrecision: (_s, a) => (Math.floor(a / 0.00001 + 1e-9) * 0.00001).toFixed(5),
    createOrder: async (symbol, _type, side, amount, _p, params) => {
      if (state.mode === "reject") throw Object.assign(new Error("Account has insufficient balance"), { name: "InsufficientFunds" });
      const o: CcxtOrder & { stopLossPrice?: number } = { id: `o${state.orders.length + 1}`, clientOrderId: params?.clientOrderId as string, symbol, side, status: "open", amount, filled: 0 };
      if (params?.stopLossPrice != null) {
        state.stopCalls++;
        o.stopLossPrice = params.stopLossPrice as number;
        state.orders.push(o);
        return { ...o };
      }
      state.calls++;
      fill(o);
      if (state.mode === "timeout-found") { state.orders.push(o); throw timeout(); }
      if (state.mode === "timeout-missing") throw timeout();
      state.orders.push(o);
      return { ...o };
    },
    fetchOrder: async (id) => ({ ...state.orders.find((o) => o.id === id)! }),
    fetchOpenOrders: async () => state.orders.filter((o) => o.status === "open").map((o) => ({ ...o })),
    fetchClosedOrders: async () => state.orders.filter((o) => o.status !== "open").map((o) => ({ ...o })),
    cancelOrder: async (id) => {
      const o = state.orders.find((x) => x.id === id);
      if (!o || o.status !== "open") throw Object.assign(new Error(`order ${id} not found or not open`), { name: "OrderNotFound" });
      o.status = "canceled";
    },
  };

  /** Fire every resting stop the current price has crossed (long stops only — the fake is spot). */
  const trigger = () => {
    for (const o of state.orders) if (o.status === "open" && o.stopLossPrice != null && state.price <= o.stopLossPrice) fill(o);
  };
  return { ex, state, trigger };
}
