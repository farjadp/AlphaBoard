import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { ExchangeConnectionInput } from "@/lib/db/inputs";
import { createConnection, exchangeTradingEnabled, listConnections, requireExchangeAccess } from "@/lib/exchanges/connections";
import { secretsConfigured } from "@/lib/secrets/crypto";

export const dynamic = "force-dynamic";

const POPULAR = ["binance", "kraken", "coinbase", "bybit", "okx", "mexc", "kucoin", "gate", "bitget", "ndax", "cryptocom"];

/** Whether exchange trading is available here, and the owner's connections (keys masked). */
export const GET = userRoute(async (_req, user) => {
  const enabled = exchangeTradingEnabled();
  const allowed = enabled && user.role === "ADMIN";
  return NextResponse.json({
    enabled,
    allowed,
    reason: !process.env.LIVE_TRADING_ENABLED ? "LIVE_TRADING_ENABLED is not set" : !secretsConfigured() ? "EXCHANGE_KEY_SECRET is missing or invalid" : user.role !== "ADMIN" ? "Only the owner (admin) can connect exchanges" : null,
    popular: POPULAR,
    connections: allowed ? await listConnections(user.id) : [],
  });
});

export const POST = userRoute(async (req, user) => {
  requireExchangeAccess(user);
  const input = ExchangeConnectionInput.parse(await readJson(req, 10_000));
  return NextResponse.json(await createConnection(user.id, input), { status: 201 });
});
