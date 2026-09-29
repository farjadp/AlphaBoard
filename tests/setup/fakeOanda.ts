/**
 * An in-memory OANDA v20 server for venue tests: one account, instruments, bid/ask pricing, FOK market
 * orders with stopLossOnFill, trades (@clientID lookup), trade close / stop edits, transactions.
 */
import type { OandaFetch } from "@/lib/venues/oanda";

interface Trade {
  id: string; instrument: string; price: string; initialUnits: string; currentUnits: string; state: "OPEN" | "CLOSED";
  clientExtensions?: { id: string }; stopLossOrder?: { id: string; price: string; state: string };
  realizedPL: string; averageClosePrice?: string; financing: string; closingTransactionIDs: string[];
}

export function fakeOanda() {
  const state = {
    prices: { XAU_USD: { bid: 2600.0, ask: 2600.6 }, EUR_USD: { bid: 1.1, ask: 1.10012 }, EUR_JPY: { bid: 160, ask: 160.02 } } as Record<string, { bid: number; ask: number }>,
    tradeable: true,
    mode: "fill" as "fill" | "timeout-after-fill" | "timeout-no-fill" | "halted",
    trades: [] as Trade[],
    transactions: [] as Array<Record<string, unknown>>,
    orders: [] as Array<Record<string, unknown>>,
    tx: 100,
    marginAvailable: 10_000,
    requests: [] as Array<{ method: string; path: string; body: unknown }>,
  };
  const instruments = {
    XAU_USD: { name: "XAU_USD", type: "METAL", displayPrecision: 3, tradeUnitsPrecision: 0, minimumTradeSize: "1", marginRate: "0.2" },
    EUR_USD: { name: "EUR_USD", type: "CURRENCY", displayPrecision: 5, tradeUnitsPrecision: 0, minimumTradeSize: "1", marginRate: "0.0333" },
    EUR_JPY: { name: "EUR_JPY", type: "CURRENCY", displayPrecision: 3, tradeUnitsPrecision: 0, minimumTradeSize: "1", marginRate: "0.04" },
  } as Record<string, unknown>;
  const nextTx = () => String(++state.tx);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const timeout = () => { throw Object.assign(new Error("fetch failed"), { name: "TimeoutError" }); };

  const closeTrade = (t: Trade, units: number, reason: string) => {
    const p = state.prices[t.instrument];
    const long = Number(t.initialUnits) > 0;
    const px = long ? p.bid : p.ask;
    const pl = (long ? px - Number(t.price) : Number(t.price) - px) * units;
    const id = nextTx();
    const rest = Math.abs(Number(t.currentUnits)) - units;
    const leg = { tradeID: t.id, units: String(long ? -units : units), price: String(px), realizedPL: pl.toFixed(4), financing: "0" };
    state.transactions.push({ id, type: "ORDER_FILL", reason, ...(rest > 0 ? { tradeReduced: leg } : { tradesClosed: [leg] }) });
    t.realizedPL = (Number(t.realizedPL) + pl).toFixed(4);
    t.currentUnits = String(long ? rest : -rest);
    if (rest <= 0) {
      t.state = "CLOSED";
      t.averageClosePrice = String(px);
      t.closingTransactionIDs.push(id);
      if (t.stopLossOrder) t.stopLossOrder.state = reason === "STOP_LOSS_ORDER" ? "FILLED" : "CANCELLED";
    }
    return { id, units: leg.units, pl: leg.realizedPL, commission: "0", financing: "0", ...(rest > 0 ? { tradeReduced: leg } : { tradesClosed: [leg] }) };
  };

  const fetch: OandaFetch = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v3\/accounts\/[^/]+/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.requests.push({ method, path: path + u.search, body });

    if (path === "/summary") return json({ account: { marginAvailable: String(state.marginAvailable), currency: "USD" }, lastTransactionID: String(state.tx) });
    if (path === "/instruments") {
      const names = (u.searchParams.get("instruments") ?? "").split(",");
      return json({ instruments: names.map((n) => instruments[n]).filter(Boolean) });
    }
    if (path === "/pricing") {
      const n = u.searchParams.get("instruments")!;
      const p = state.prices[n];
      return json({ prices: p ? [{ instrument: n, tradeable: state.tradeable, bids: [{ price: String(p.bid) }], asks: [{ price: String(p.ask) }] }] : [] });
    }
    if (path === "/orders" && method === "POST") {
      const o = body.order;
      if (state.mode === "halted") return json({ orderCreateTransaction: { id: nextTx() }, orderCancelTransaction: { id: nextTx(), reason: "MARKET_HALTED" } }, 201);
      if (state.mode === "timeout-no-fill") timeout();
      const p = state.prices[o.instrument];
      const units = Number(o.units);
      const px = units > 0 ? p.ask : p.bid;
      const tradeId = nextTx();
      const trade: Trade = {
        id: tradeId, instrument: o.instrument, price: String(px), initialUnits: o.units, currentUnits: o.units, state: "OPEN", realizedPL: "0", financing: "0",
        clientExtensions: o.tradeClientExtensions, closingTransactionIDs: [], stopLossOrder: o.stopLossOnFill ? { id: nextTx(), price: o.stopLossOnFill.price, state: "PENDING" } : undefined,
      };
      state.trades.push(trade);
      const fill = { id: tradeId, type: "ORDER_FILL", clientOrderID: o.clientExtensions?.id, units: o.units, commission: "0", tradeOpened: { tradeID: tradeId, units: o.units, price: String(px) } };
      state.transactions.push(fill);
      if (state.mode === "timeout-after-fill") timeout();
      return json({ orderCreateTransaction: { id: nextTx() }, orderFillTransaction: fill, lastTransactionID: String(state.tx) }, 201);
    }
    const byClient = /^\/trades\/@(.+)$/.exec(path);
    if (byClient) {
      const t = state.trades.find((x) => x.clientExtensions?.id === decodeURIComponent(byClient[1]));
      return t ? json({ trade: t }) : json({ errorMessage: "The Trade specified does not exist" }, 404);
    }
    const tradeMatch = /^\/trades\/(\d+)(\/close|\/orders)?$/.exec(path);
    if (tradeMatch) {
      const t = state.trades.find((x) => x.id === tradeMatch[1]);
      if (!t) return json({ errorMessage: "no such trade" }, 404);
      if (tradeMatch[2] === "/close") {
        if (!state.tradeable) return json({ orderCreateTransaction: {}, orderCancelTransaction: { reason: "MARKET_HALTED" } });
        const units = body.units === "ALL" ? Math.abs(Number(t.currentUnits)) : Number(body.units);
        return json({ orderCreateTransaction: {}, orderFillTransaction: closeTrade(t, units, "MARKET_ORDER_TRADE_CLOSE") });
      }
      if (tradeMatch[2] === "/orders") {
        t.stopLossOrder = { id: nextTx(), price: body.stopLoss.price, state: "PENDING" };
        return json({ stopLossOrderTransaction: { id: t.stopLossOrder.id } });
      }
      return json({ trade: t });
    }
    if (path === "/openTrades") return json({ trades: state.trades.filter((t) => t.state === "OPEN") });
    if (path.startsWith("/transactions/sinceid")) {
      const since = Number(u.searchParams.get("id"));
      return json({ transactions: state.transactions.filter((t) => Number(t.id) > since) });
    }
    const txMatch = /^\/transactions\/(\d+)$/.exec(path);
    if (txMatch) return json({ transaction: state.transactions.find((t) => t.id === txMatch[1]) ?? {} });
    return json({ errorMessage: `unhandled ${method} ${path}` }, 404);
  };

  /** Fire resting broker stops the current price has crossed. */
  const trigger = () => {
    for (const t of state.trades.filter((x) => x.state === "OPEN" && x.stopLossOrder?.state === "PENDING")) {
      const p = state.prices[t.instrument];
      const long = Number(t.initialUnits) > 0;
      const stop = Number(t.stopLossOrder!.price);
      if (long ? p.bid <= stop : p.ask >= stop) closeTrade(t, Math.abs(Number(t.currentUnits)), "STOP_LOSS_ORDER");
    }
  };
  return { fetch, state, trigger };
}
