/** A fake ccxt exchange for venue / reconciler tests (BTC/USDT spot, 0.1% fees, configurable failures). */
import type { CcxtMarket, CcxtOrder, ExchangeLike } from "@/lib/venues/ccxtClient";

export const market: CcxtMarket = { symbol: "BTC/USDT", base: "BTC", quote: "USDT", active: true, taker: 0.001, limits: { amount: { min: 0.00001 }, cost: { min: 5 } }, precision: { amount: 0.00001 } };

export function fakeExchange() {
  const state = {
    price: 100_000,
    mode: "fill" as "fill" | "timeout-found" | "timeout-missing" | "reject",
    orders: [] as CcxtOrder[],
    calls: 0,
    balance: { BTC: 0, USDT: 1_000 },
  };
  const timeout = () => Object.assign(new Error("request timed out"), { name: "RequestTimeout" });
  const ex: ExchangeLike = {
    id: "fake", has: {},
    loadMarkets: async () => ({ "BTC/USDT": market }),
    fetchTicker: async () => ({ last: state.price }),
    fetchBalance: async () => ({ free: { ...state.balance }, total: { ...state.balance } }),
    amountToPrecision: (_s, a) => (Math.floor(a / 0.00001 + 1e-9) * 0.00001).toFixed(5),
    createOrder: async (symbol, _type, side, amount, _p, params) => {
      state.calls++;
      if (state.mode === "reject") throw Object.assign(new Error("Account has insufficient balance"), { name: "InsufficientFunds" });
      const o: CcxtOrder = {
        id: `o${state.orders.length + 1}`, clientOrderId: params?.clientOrderId as string, symbol, side, status: "closed", amount, filled: amount, average: state.price,
        fee: side === "buy" ? { cost: amount * 0.001, currency: "BTC" } : { cost: amount * state.price * 0.001, currency: "USDT" },
      };
      if (side === "buy") state.balance.BTC += amount - amount * 0.001;
      else state.balance.BTC -= amount;
      if (state.mode === "timeout-found") { state.orders.push(o); throw timeout(); }
      if (state.mode === "timeout-missing") throw timeout();
      state.orders.push(o);
      return o;
    },
    fetchOrder: async (id) => state.orders.find((o) => o.id === id)!,
    fetchOpenOrders: async () => [],
    fetchClosedOrders: async () => state.orders,
    cancelOrder: async () => undefined,
  };
  return { ex, state };
}

