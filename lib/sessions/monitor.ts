import "server-only";
import type { SessionCloseReason, SessionPosition, TradingSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { liquidationPrice } from "@/lib/paper/engine";
import { livePrice, type PriceOf } from "@/lib/paper/account";
import { telegramFromEnv, type Telegram } from "@/lib/notify/telegram";
import { promptExtension, resolveExtensionPrompt } from "@/lib/notify/sessionTelegram";
import { notify } from "@/lib/notify/notifications";
import type { AiFn } from "@/lib/agents/run";
import { money } from "@/lib/risk/limits";
import { runCycle } from "./cycle";
import { exitPosition, flatten, sessionPriceOf } from "./exits";
import { reconcileSession, RECONCILE_EVERY_MS } from "@/lib/exec/reconciler";
import { journalClosedPosition, writeReport } from "./journal";
import { isActive, timerTransition } from "./lifecycle";
import { post } from "./room";
import { finishSession } from "./service";
import { mandateOf, markOpen, sessionMoney } from "./view";

export interface MonitorDeps {
  now?: Date;
  priceOf?: PriceOf;
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

/** Which exit, if any, the live price triggers. Liquidation first, then the stop, then the target. */
export function exitFor(p: Pick<SessionPosition, "side" | "leverage" | "entryPrice" | "stopLoss" | "takeProfit">, price: number): SessionCloseReason | null {
  const long = p.side === "LONG";
  if (p.leverage > 1) {
    const liq = liquidationPrice(p.side, p.entryPrice, p.leverage);
    if (long ? price <= liq : price >= liq) return "LIQUIDATION";
  }
  if (p.stopLoss != null && (long ? price <= p.stopLoss : price >= p.stopLoss)) return "STOP_LOSS";
  if (p.takeProfit != null && (long ? price >= p.takeProfit : price <= p.takeProfit)) return "TAKE_PROFIT";
  return null;
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
  // Exchange sessions act on the exchange's own ticker unless a price source is injected (tests).
  const priceFor = async (s: { venue: string; connectionId: string | null }) =>
    (deps.priceOf || s.venue !== "exchange" ? priceOf : cachedPrices(await sessionPriceOf(s, priceOf)));
  const telegram = deps.telegram === undefined ? telegramFromEnv() : deps.telegram;
  const exitDeps = { priceOf, telegram };
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
      await monitorOne(s, now, sp, { ...exitDeps, priceOf: sp }, result);
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

async function monitorOne(s: Loaded, now: Date, priceOf: PriceOf, exitDeps: { priceOf: PriceOf; telegram: Telegram | null }, result: MonitorResult) {
  const m = mandateOf(s);

  // 1. Software stops / targets / liquidation — in every state, including after the end (KEEP_WITH_STOPS).
  for (const p of s.positions.filter((x) => !x.closedAt)) {
    const price = await priceOf(p.symbol);
    if (price == null) continue;
    const reason = exitFor(p, price);
    if (!reason) continue;
    const level = reason === "LIQUIDATION" ? liquidationPrice(p.side, p.entryPrice, p.leverage) : undefined;
    const r = await exitPosition(s, p, reason, { ...exitDeps, price: level });
    if (r) result.exits.push({ positionId: p.id, reason });
  }

  // 2. Pending closes after a halt / close-all end.
  if (!isActive(s.status) && !s.keepOpen && (await prisma.sessionPosition.count({ where: { sessionId: s.id, closedAt: null } }))) {
    await flatten(s, s.endReason === "KILL" ? "KILL" : s.endReason === "LOSS_LIMIT" ? "LOSS_LIMIT" : "SESSION_END", exitDeps);
    return;
  }
  if (!isActive(s.status)) return;

  // 3. Session loss limit (realized + unrealized − fees).
  const current = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id }, include: { positions: true } });
  const marks = await markOpen(current.positions.filter((p) => !p.closedAt), priceOf);
  const money$ = sessionMoney(current, marks);
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
