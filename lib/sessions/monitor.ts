import "server-only";
import type { SessionCloseReason, SessionPosition, TradingSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { liquidationPrice } from "@/lib/paper/engine";
import { exitAtPrice, nextExtremes, scanExit, trailingStop, type Bar } from "@/lib/trading/positions";
import { computeAtr } from "@/lib/market/indicators";
import { fmt } from "@/lib/risk/limits";
import { findAsset } from "@/lib/assetCatalog";
import { env } from "@/lib/env";
import { getCandles } from "@/lib/market/candles";
import { livePrice, type PriceOf } from "@/lib/paper/account";
import { telegramFromEnv, type Telegram } from "@/lib/notify/telegram";
import { promptExtension, resolveExtensionPrompt } from "@/lib/notify/sessionTelegram";
import { notify } from "@/lib/notify/notifications";
import type { AiFn } from "@/lib/agents/run";
import { money } from "@/lib/risk/limits";
import { minutesToWeeklyClose, tradesWeekdaysOnly } from "@/lib/market/hours";
import { runCycle } from "./cycle";
import { announceExit, exitPosition, flatten, sessionPriceOf, venueFor } from "./exits";
import { reconcileSession, RECONCILE_EVERY_MS } from "@/lib/exec/reconciler";
import { journalClosedPosition, writeReport } from "./journal";
import { isActive, timerTransition } from "./lifecycle";
import { post } from "./room";
import { finishSession } from "./service";
import { nextDrawdown } from "./drawdown";
import { mandateOf, markOpen, sessionMoney } from "./view";

export type BarsOf = (symbol: string) => Promise<Bar[]>;

export interface MonitorDeps {
  now?: Date;
  priceOf?: PriceOf;
  /** 5-minute candles for the stop/target scan; defaults to the market data layer, or to none when a test injects prices. */
  barsOf?: BarsOf;
  /** 1H ATR(14) for trailing stops; same defaulting rule as barsOf. */
  atrOf?: (symbol: string) => Promise<number | null>;
  ai?: AiFn;
  telegram?: Telegram | null;
  /** Tests await the background work (cycles, journal, report); the worker fires and forgets. */
  awaitBackground?: boolean;
  /** Start decision cycles for running sessions (default true). */
  cycles?: boolean;
}

export interface MonitorResult {
  sessions: number;
  exits: Array<{ positionId: string; reason: SessionCloseReason }>;
  halted: string[];
  prompted: string[];
  ended: string[];
  errors: string[];
}

/** How far past an exchange-held stop the software fallback waits before closing at market itself. */
const NATIVE_STOP_SLACK = 0.003;
/** Weekday-only positions are closed (CLOSE_ALL) this long before the Friday close; all-FX sessions end then too. */
const FLATTEN_BEFORE_CLOSE_MIN = 20;

/** Which exit, if any, the live price triggers. Liquidation first, then the stop, then the target. */
export function exitFor(p: Pick<SessionPosition, "side" | "leverage" | "entryPrice" | "stopLoss" | "takeProfit">, price: number): SessionCloseReason | null {
  return exitAtPrice(p, price);
}

/** 5-minute candles from the market data layer; [] for symbols outside the catalog or when the provider fails. */
const liveBars: BarsOf = async (symbol) => {
  const asset = findAsset(symbol);
  if (!asset) return [];
  return (await getCandles(asset, "5M")).flatMap((c) => (c.time == null ? [] : [{ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }]));
};

const liveAtr = async (symbol: string) => {
  const asset = findAsset(symbol);
  if (!asset) return null;
  return computeAtr(await getCandles(asset, "1H"));
};

/** Consecutive passes without a price, per position; an alert goes to the room after MISSING_PRICE_ALERT_AFTER. */
const missingPrice = new Map<string, number>();
const MISSING_PRICE_ALERT_AFTER = 3;

/** Per-pass candle cache; a failed fetch counts as no candles (the spot price still gets checked). */
function cachedBars(barsOf: BarsOf): BarsOf {
  const cache = new Map<string, Promise<Bar[]>>();
  return (s) => {
    if (!cache.has(s)) cache.set(s, barsOf(s).catch(() => []));
    return cache.get(s)!;
  };
}

/** Per-pass price cache so every position of a symbol sees the same price. */
function cachedPrices(priceOf: PriceOf): PriceOf {
  const cache = new Map<string, Promise<number | null>>();
  return (s) => {
    if (!cache.has(s)) cache.set(s, priceOf(s).catch(() => null));
    return cache.get(s)!;
  };
}

/**
 * Every 15 s (spec §4.3–4.5): software stops/targets/liquidation, the session loss limit, the end-of-session
 * prompt and its timeout, retries of pending closes, then background journal, report and decision cycles.
 */
export async function monitorSessions(deps: MonitorDeps = {}): Promise<MonitorResult> {
  const now = deps.now ?? new Date();
  const priceOf = cachedPrices(deps.priceOf ?? livePrice);
  // Tests inject prices (or a fake exchange) and never want the market data layer; production always does.
  const offline = !!deps.priceOf || env().NODE_ENV === "test";
  const barsOf = cachedBars(deps.barsOf ?? (offline ? async () => [] : liveBars));
  const atrOf = deps.atrOf ?? (offline ? async () => null : liveAtr);
  // Exchange sessions act on the exchange's own ticker unless a price source is injected (tests).
  const priceFor = async (s: { venue: string; connectionId: string | null }) =>
    (deps.priceOf || s.venue !== "exchange" ? priceOf : cachedPrices(await sessionPriceOf(s, priceOf)));
  const telegram = deps.telegram === undefined ? telegramFromEnv() : deps.telegram;
  const exitDeps = { priceOf, telegram, now };
  const result: MonitorResult = { sessions: 0, exits: [], halted: [], prompted: [], ended: [], errors: [] };
  const background: Array<Promise<unknown>> = [];
  const bg = (label: string, p: Promise<unknown>) => background.push(p.catch((e) => {
    result.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    logger.warn({ label, err: e instanceof Error ? e.message : String(e) }, "session background task failed");
  }));

  const sessions = await prisma.tradingSession.findMany({
    where: {
      OR: [
        { status: { in: ["RUNNING", "PAUSED", "AWAITING_EXTENSION", "ENDING"] } },
        { positions: { some: { closedAt: null } } },
        { status: { in: ["ENDED", "HALTED"] }, report: null },
        { positions: { some: { closedAt: { not: null }, journalEntryId: null } } },
      ],
    },
    include: { positions: true, report: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  result.sessions = sessions.length;

  for (const s of sessions) {
    try {
      const sp = await priceFor(s);
      await monitorOne(s, now, sp, barsOf, atrOf, { ...exitDeps, priceOf: sp }, result);
      // Exchange sessions: compare the venue with the ledger every 30 s while active or holding positions.
      if (s.venue === "exchange" && (!s.lastReconciledAt || now.getTime() - s.lastReconciledAt.getTime() >= RECONCILE_EVERY_MS)) {
        const latest = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id }, include: { positions: { where: { closedAt: null }, select: { id: true } } } });
        if (isActive(latest.status) || latest.positions.length) {
          const r = await reconcileSession(latest, { now, telegram });
          if (r.issues.length) result.halted.push(s.id);
        }
      }
    } catch (e) {
      result.errors.push(`${s.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const fresh = await prisma.tradingSession.findUnique({ where: { id: s.id }, include: { positions: true, report: { select: { id: true } } } });
    if (!fresh) continue;
    // Journal closed trades (the lesson is an AI call — background).
    for (const p of fresh.positions.filter((x) => x.closedAt && !x.journalEntryId).slice(0, 3)) bg(`journal ${p.id}`, journalClosedPosition(p.id, { ai: deps.ai, telegram }));
    if (!isActive(fresh.status) && !fresh.report && fresh.positions.every((p) => p.closedAt)) {
      const pendingJournal = fresh.positions.some((p) => !p.journalEntryId);
      const waited = now.getTime() - (fresh.endedAt ?? now).getTime() > 5 * 60_000;
      if (!pendingJournal || waited) bg(`report ${fresh.id}`, writeReport(fresh.id, { ai: deps.ai, priceOf, telegram, now }));
    }
    if (fresh.status === "RUNNING" && deps.cycles !== false) bg(`cycle ${fresh.id}`, runCycle(fresh.id, { ai: deps.ai, priceOf: deps.priceOf ? priceOf : undefined, telegram, now }));
  }

  if (deps.awaitBackground) await Promise.all(background);
  return result;
}

type Loaded = TradingSession & { positions: SessionPosition[] };

async function monitorOne(s: Loaded, now: Date, priceOf: PriceOf, barsOf: BarsOf, atrOf: (symbol: string) => Promise<number | null>, exitDeps: { priceOf: PriceOf; telegram: Telegram | null; now: Date }, result: MonitorResult) {
  const m = mandateOf(s);

  // 0. Exchange stops that fired since the last pass (native-stop venues).
  const nativelyProtected = new Set<string>();
  const nativelyTargeted = new Set<string>();
  if (s.venue === "exchange" && s.positions.some((p) => !p.closedAt)) {
    const venue = await venueFor(s);
    for (const b of (await venue.syncStops?.(s.id)) ?? []) {
      const pos = s.positions.find((p) => p.id === b.positionId)!;
      const fresh = await prisma.sessionPosition.findUnique({ where: { id: pos.id }, select: { closeReason: true } });
      const reason = fresh?.closeReason === "TAKE_PROFIT" ? "TAKE_PROFIT" : "STOP_LOSS";
      await announceExit(s, pos, reason, b.result, { telegram: exitDeps.telegram, onExchange: true });
      result.exits.push({ positionId: pos.id, reason });
    }
    const resting = await prisma.sessionOrder.findMany({ where: { sessionId: s.id, purpose: { in: ["STOP", "TAKE_PROFIT"] }, status: "OPEN" }, select: { positionId: true, purpose: true } });
    for (const r of resting) if (r.positionId) (r.purpose === "STOP" ? nativelyProtected : nativelyTargeted).add(r.positionId);
  }

  // 1. Software stops / targets / liquidation — in every state, including after the end (KEEP_WITH_STOPS).
  //    Candles since the last check catch a wick between two 15 s polls (P14a); the live price covers the
  //    forming candle. A position with a stop resting on the exchange gets NATIVE_STOP_SLACK first.
  const open = await prisma.sessionPosition.findMany({ where: { sessionId: s.id, closedAt: null } });
  for (const p of open) {
    const [price, bars] = await Promise.all([priceOf(p.symbol), barsOf(p.symbol)]);
    if (price == null && bars.length === 0) {
      // No price at all: say so in the room after a few passes instead of staying silent (P14c).
      const misses = (missingPrice.get(p.id) ?? 0) + 1;
      missingPrice.set(p.id, misses);
      if (misses === MISSING_PRICE_ALERT_AFTER) await alertOnce(s.id, `No price for ${p.symbol}`, `No price for ${p.symbol} for ${misses} checks: the stop and target cannot be watched until a price comes back.`, now);
      continue;
    }
    missingPrice.delete(p.id);
    const since = p.lastCheckedAt.getTime();
    const seen = bars.filter((b) => b.time >= since);
    const hi = Math.max(price ?? -Infinity, ...seen.map((b) => b.high));
    const lo = Math.min(price ?? Infinity, ...seen.map((b) => b.low));
    const ext = nextExtremes(p, { high: hi, low: lo });
    if (ext) await prisma.sessionPosition.updateMany({ where: { id: p.id, closedAt: null }, data: ext });
    const slack = nativelyProtected.has(p.id) && p.stopLoss != null ? p.stopLoss * NATIVE_STOP_SLACK * (p.side === "LONG" ? -1 : 1) : 0;
    const tpSlack = nativelyTargeted.has(p.id) && p.takeProfit != null ? p.takeProfit * NATIVE_STOP_SLACK * (p.side === "LONG" ? 1 : -1) : 0;
    const judged = { ...p, stopLoss: p.stopLoss == null ? null : p.stopLoss + slack, takeProfit: p.takeProfit == null ? null : p.takeProfit + tpSlack };
    const spot = price == null ? null : exitFor(judged, price);
    const hit = spot ?? scanExit(judged, seen, since)?.reason ?? null;
    if (!hit) {
      const latestStart = Math.max(...seen.map((b) => b.time), 0);
      if (latestStart > since) await prisma.sessionPosition.updateMany({ where: { id: p.id, closedAt: null }, data: { lastCheckedAt: new Date(latestStart) } });
      if (price != null) await trailOne(s, p, price, atrOf, now, exitDeps);
      continue;
    }
    const level = hit === "LIQUIDATION" ? liquidationPrice(p.side, p.entryPrice, p.leverage) : undefined;
    const r = await exitPosition(s, p, hit, { ...exitDeps, price: level });
    if (r) result.exits.push({ positionId: p.id, reason: hit });
  }

  // 1b. Weekly market close: nothing on a weekday-only market is held into the weekend gap.
  if (await weeklyClose(s, m, now, exitDeps, result)) return;

  // 2. Pending closes after a halt / close-all end.
  if (!isActive(s.status) && !s.keepOpen && (await prisma.sessionPosition.count({ where: { sessionId: s.id, closedAt: null } }))) {
    const e = s.endReason;
    await flatten(s, e === "KILL" ? "KILL" : e === "LOSS_LIMIT" ? "LOSS_LIMIT" : e === "MARKET_CLOSE" ? "MARKET_CLOSE" : "SESSION_END", exitDeps);
    return;
  }
  if (!isActive(s.status)) return;

  // 3. Session loss limit (realized + unrealized − fees).
  const current = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id }, include: { positions: true } });
  const marks = await markOpen(current.positions.filter((p) => !p.closedAt), priceOf);
  const money$ = sessionMoney(current, marks);
  // Mark-to-market drawdown (P11a): recorded before the loss-limit check so a halt keeps its deepest point.
  if (money$.equity != null) {
    const d = nextDrawdown({ peak: current.equityPeak, maxDd: current.maxDrawdownMtm }, money$.equity);
    if (d.changed) await prisma.tradingSession.update({ where: { id: s.id }, data: { equityPeak: d.peak, maxDrawdownMtm: d.maxDd } });
  }
  const loss = money$.lossUsed ?? Math.max(0, -money$.realizedNet);
  if (loss >= m.lossLimit) {
    await post(s.id, "RISK", "ALERT", `Loss limit hit: ${money(loss)} of ${money(m.lossLimit)}.`);
    await finishSession(current, "LOSS_LIMIT", "CLOSE_ALL", exitDeps);
    result.halted.push(s.id);
    return;
  }

  // 4. Clock.
  const t = timerTransition({
    status: current.status, now: now.getTime(), endsAt: current.endsAt.getTime(),
    extensionPromptAt: current.extensionPromptAt?.getTime() ?? null, extensionTimeoutMin: m.extensionTimeoutMin,
  });
  if (t === "PROMPT_EXTENSION") {
    const moved = await prisma.tradingSession.updateMany({ where: { id: s.id, status: current.status }, data: { status: "AWAITING_EXTENSION", extensionPromptAt: now } });
    if (moved.count !== 1) return;
    const fallback = m.onEnd === "CLOSE_ALL" ? "end the session and close all positions" : "end the session and keep positions with their stops";
    await post(s.id, "SYSTEM", "ALERT", `Time is up. Extend the session? Without an answer in ${m.extensionTimeoutMin} min I will ${fallback}.`, { prompt: "extension" });
    const sent = await promptExtension(current, exitDeps.telegram, now);
    if (sent == null) {
      await notify(s.userId, { type: "session", title: `${s.name}: time is up`, body: `Extend it from the session page within ${m.extensionTimeoutMin} min, or it will ${fallback}.`, data: { sessionId: s.id, href: `/sessions/${s.id}` } }, null).catch(() => undefined);
    }
    result.prompted.push(s.id);
  } else if (t === "EXTENSION_TIMEOUT" || current.status === "ENDING") {
    const latest = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    await finishSession(latest, t === "EXTENSION_TIMEOUT" ? "EXTENSION_TIMEOUT" : "COMPLETED", m.onEnd, exitDeps);
    await resolveExtensionPrompt(latest, `no answer in ${m.extensionTimeoutMin} min — session ended${m.onEnd === "CLOSE_ALL" ? ", positions closed" : ", positions kept with stops"}.`, exitDeps.telegram);
    result.ended.push(s.id);
  }
}

/** Trailing stop for one position when its plan asks for it (P14c): mult × 1H ATR behind the price, tightening only. */
async function trailOne(s: Loaded, p: SessionPosition, price: number, atrOf: (symbol: string) => Promise<number | null>, now: Date, exitDeps: { telegram: Telegram | null; priceOf: PriceOf }) {
  const plan = (p.exitPlan ?? {}) as { trailAtr?: number | null; initialStop?: number | null };
  if (!plan.trailAtr) return;
  const d = trailingStop({ side: p.side, entryPrice: p.entryPrice, stopLoss: p.stopLoss, initialStop: plan.initialStop ?? null }, { price, atr: await atrOf(p.symbol), mult: plan.trailAtr, minStep: undefined });
  if (!d) return;
  if ("problem" in d) {
    if (d.problem.code === "NO_ATR") await alertOnce(s.id, `Trailing paused on ${p.symbol}`, `Trailing paused on ${p.symbol}: no 1H ATR available.`, now);
    return;
  }
  // Move only by a visible step (a tenth of the trail distance) so the room is not flooded.
  const atr = await atrOf(p.symbol);
  if (p.stopLoss != null && atr && Math.abs(d.stop - p.stopLoss) < atr * plan.trailAtr * 0.1) return;
  const venue = await venueFor(s, exitDeps.priceOf);
  const fired = await venue.setStop(p.id, d.stop);
  if (fired) {
    await announceExit(s, p, "STOP_LOSS", fired, { telegram: exitDeps.telegram, onExchange: true });
    return;
  }
  await prisma.sessionPosition.updateMany({ where: { id: p.id, closedAt: null }, data: { lastCheckedAt: now } });
  await post(s.id, "EXECUTOR", "ORDER", `${p.symbol} stop trailed ${p.stopLoss == null ? "" : `${fmt(p.stopLoss)} → `}${fmt(d.stop)} (${plan.trailAtr}× ATR).`, { positionId: p.id, stopLoss: d.stop, trail: true });
}

/**
 * Before the Friday close (FLATTEN_BEFORE_CLOSE_MIN): close weekday-only positions unless the mandate keeps
 * positions (then warn once), and end an active session whose every symbol is weekday-only.
 * Returns true when the session was ended here.
 */
async function weeklyClose(s: Loaded, m: ReturnType<typeof mandateOf>, now: Date, exitDeps: { priceOf: PriceOf; telegram: Telegram | null; now: Date }, result: MonitorResult) {
  const left = minutesToWeeklyClose(now);
  if (left <= 0 || left > FLATTEN_BEFORE_CLOSE_MIN) return false;
  const open = await prisma.sessionPosition.findMany({ where: { sessionId: s.id, closedAt: null } });
  const exposed = open.filter((p) => tradesWeekdaysOnly(p.symbol));
  const keep = m.onEnd === "KEEP_WITH_STOPS" && (isActive(s.status) || s.keepOpen);
  if (exposed.length && keep) {
    const body = `Weekly close in ${left} min: ${exposed.map((p) => p.symbol).join(", ")} stay open over the weekend with their stops (mandate: keep positions). A weekend gap can fill a stop at a worse price.`;
    if (await alertOnce(s.id, "Weekly close", body, now)) {
      await notify(s.userId, { type: "session", title: `${s.name}: weekly close`, body, data: { sessionId: s.id, href: `/sessions/${s.id}` } }, exitDeps.telegram).catch(() => undefined);
    }
  } else {
    for (const p of exposed) {
      try {
        const r = await exitPosition(s, p, "MARKET_CLOSE", exitDeps);
        if (r) result.exits.push({ positionId: p.id, reason: "MARKET_CLOSE" });
      } catch (e) {
        await alertOnce(s.id, `Could not close ${p.symbol} before the weekly close`, `Could not close ${p.symbol} before the weekly close: ${e instanceof Error ? e.message : String(e)} — retrying every 15 s.`, now);
      }
    }
  }
  if (isActive(s.status) && m.symbols.every(tradesWeekdaysOnly)) {
    const current = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    await finishSession(current, "MARKET_CLOSE", m.onEnd, exitDeps);
    result.ended.push(s.id);
    return true;
  }
  return false;
}

/** Post an alert unless one starting with `prefix` was posted in the last hour (the monitor runs every 15 s). */
async function alertOnce(sessionId: string, prefix: string, body: string, now: Date) {
  const recent = await prisma.sessionMessage.count({ where: { sessionId, kind: "ALERT", body: { startsWith: prefix }, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } } });
  if (recent) return false;
  await post(sessionId, "SYSTEM", "ALERT", body);
  return true;
}
