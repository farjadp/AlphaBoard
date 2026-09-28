import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findAsset } from "@/lib/assetCatalog";
import { logger } from "@/lib/http/logger";
import { getCandles } from "@/lib/market/candles";
import { livePrice, settlePosition, snapshotEquity, type PriceOf } from "@/lib/paper/account";
import { scanExit, type Bar } from "@/lib/paper/engine";
import { evaluatePendingSignals, type SignalBarsOf } from "@/lib/eval/job";
import { evaluateAlerts } from "@/lib/alerts/job";
import { notify } from "@/lib/notify/notifications";
import { telegramFromEnv, type Telegram } from "@/lib/notify/telegram";
import { processTelegramUpdates } from "@/lib/notify/telegramLink";

export const TICK_KEY = "tick.last";
const SNAPSHOT_EVERY_MS = 15 * 60_000;

export interface TickDeps {
  now?: () => Date;
  /** Recent 5m candles for a symbol, oldest first; null when unavailable. */
  barsOf?: (symbol: string) => Promise<Bar[] | null>;
  priceOf?: PriceOf;
  /** Candles of a signal's own timeframe (signal evaluation). */
  signalBarsOf?: SignalBarsOf;
  /** Telegram bot; defaults to TELEGRAM_BOT_TOKEN (null = off). */
  telegram?: Telegram | null;
}

export interface TickResult {
  at: string;
  ms: number;
  positions: number;
  symbols: number;
  closed: Array<{ id: string; symbol: string; reason: string }>;
  snapshots: number;
  signals: { checked: number; resolved: number };
  alerts: { active: number; fired: number };
  telegram: { updates: number; linked: number } | null;
  errors: string[];
}

const liveBars = async (symbol: string): Promise<Bar[] | null> => {
  const asset = findAsset(symbol);
  if (!asset) return null;
  return (await getCandles(asset, "5M")).flatMap((c) => (c.time == null ? [] : [{ ...c, time: c.time }]));
};

/**
 * One scheduler tick: settle paper positions whose SL/TP/liquidation level was crossed by a candle
 * high/low (or the live quote), snapshot equity for active accounts, evaluate pending AI signals (P5),
 * fire price alerts and process Telegram link messages (P6). Each part is isolated: one failing never
 * skips the rest.
 */
export async function runTick(deps: TickDeps = {}): Promise<TickResult> {
  const now = deps.now ?? (() => new Date());
  const barsOf = deps.barsOf ?? liveBars;
  const priceOf = deps.priceOf ?? livePrice;
  const telegram = deps.telegram === undefined ? telegramFromEnv() : deps.telegram;
  const started = now();
  const errors: string[] = [];
  const closed: TickResult["closed"] = [];

  const open = await prisma.paperPosition.findMany({ where: { closedAt: null }, orderBy: { openedAt: "asc" }, take: 5_000 });
  const symbols = [...new Set(open.map((p) => p.symbol))];
  const market = new Map(await Promise.all(symbols.map(async (s) => {
    const [bars, price] = await Promise.all([
      barsOf(s).catch((e) => { errors.push(`${s} candles: ${e instanceof Error ? e.message : e}`); return null; }),
      priceOf(s).catch(() => null),
    ]);
    return [s, { bars: bars ?? [], price }] as const;
  })));

  for (const pos of open) {
    const m = market.get(pos.symbol)!;
    const t = now().getTime();
    // The live quote is a zero-range bar "now": it covers the entry candle, which scanExit skips.
    const bars = m.price != null ? [...m.bars, { time: t, open: m.price, high: m.price, low: m.price, close: m.price }] : m.bars;
    if (bars.length === 0) continue;
    try {
      const exit = scanExit(pos, bars, pos.lastCheckedAt.getTime());
      if (exit) {
        const r = await settlePosition(pos, exit.reason, exit.level, now());
        if (r) {
          closed.push({ id: pos.id, symbol: pos.symbol, reason: exit.reason });
          const owner = await prisma.paperAccount.findUnique({ where: { id: pos.accountId }, select: { userId: true } });
          if (owner) {
            const what = { STOP_LOSS: "stop-loss", TAKE_PROFIT: "take-profit", LIQUIDATION: "liquidation" }[exit.reason];
            await notify(owner.userId, {
              type: "paper_close",
              title: `Paper ${pos.side.toLowerCase()} ${pos.symbol} closed by ${what}`,
              body: `Exit ${r.exitPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })} · net PnL ${r.realizedPnl >= 0 ? "+" : "−"}${Math.abs(r.realizedPnl).toFixed(2)} USDT.`,
              data: { positionId: pos.id, href: "/paper" },
            }, telegram).catch((e) => errors.push(`notify ${pos.id}: ${e instanceof Error ? e.message : e}`));
          }
        }
        continue;
      }
      // Re-scan the still-forming candle next time; never move back before the entry.
      const latestStart = Math.max(...m.bars.map((b) => b.time), 0);
      if (latestStart > pos.lastCheckedAt.getTime()) {
        await prisma.paperPosition.updateMany({ where: { id: pos.id, closedAt: null }, data: { lastCheckedAt: new Date(latestStart) } });
      }
    } catch (e) {
      errors.push(`${pos.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Equity curve: accounts that traded this tick or hold positions, at most every 15 minutes.
  const due = new Date(now().getTime() - SNAPSHOT_EVERY_MS);
  const accounts = await prisma.paperAccount.findMany({
    where: {
      OR: [{ id: { in: [...new Set(open.filter((p) => closed.some((c) => c.id === p.id)).map((p) => p.accountId))] } },
        { positions: { some: { closedAt: null } }, OR: [{ snapshotAt: null }, { snapshotAt: { lt: due } }] }],
    },
    select: { id: true },
  });
  const cachedPrice: PriceOf = (s) => Promise.resolve(market.get(s)?.price ?? null).then((p) => p ?? priceOf(s));
  let snapshots = 0;
  for (const a of accounts) {
    try {
      if ((await snapshotEquity(a.id, cachedPrice, now())) != null) snapshots++;
    } catch (e) {
      errors.push(`snapshot ${a.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  let signals = { checked: 0, resolved: 0 };
  try {
    const ev = await evaluatePendingSignals({ now: now(), barsOf: deps.signalBarsOf });
    signals = { checked: ev.checked, resolved: ev.resolved };
    errors.push(...ev.errors);
  } catch (e) {
    errors.push(`signal evaluation: ${e instanceof Error ? e.message : e}`);
  }

  let alerts = { active: 0, fired: 0 };
  try {
    const a = await evaluateAlerts({ now: now(), barsOf, priceOf, telegram });
    alerts = { active: a.active, fired: a.fired };
    errors.push(...a.errors);
  } catch (e) {
    errors.push(`alerts: ${e instanceof Error ? e.message : e}`);
  }

  let tg: TickResult["telegram"] = null;
  if (telegram) {
    try {
      tg = await processTelegramUpdates(telegram, now());
    } catch (e) {
      errors.push(`telegram: ${e instanceof Error ? e.message : e}`);
    }
  }

  const result: TickResult = {
    at: started.toISOString(), ms: now().getTime() - started.getTime(),
    positions: open.length, symbols: symbols.length, closed, snapshots, signals, alerts, telegram: tg, errors: errors.slice(0, 20),
  };
  const value = result as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: TICK_KEY }, create: { key: TICK_KEY, value }, update: { value } });
  if (errors.length) logger.warn({ ...result }, "tick finished with errors");
  else if (closed.length || signals.resolved || alerts.fired) logger.info({ ...result }, "tick settled positions");
  return result;
}
