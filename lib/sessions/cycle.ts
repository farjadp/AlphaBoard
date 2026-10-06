import "server-only";
import type { Prisma, SessionPosition, TradingSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { aiJson } from "@/lib/ai";
import { livePrice, type PriceOf } from "@/lib/paper/account";
import { notify } from "@/lib/notify/notifications";
import type { Telegram } from "@/lib/notify/telegram";
import { gatherSymbol, type ContextData, type PositionContext, type SymbolContext } from "@/lib/agents/context";
import { runAnalysts, runDebate, runStrategist, type AiFn } from "@/lib/agents/run";
import type { AnalystNotes } from "@/lib/agents/schemas";
import { fmt, money } from "@/lib/risk/limits";
import { evaluateProposal, type Proposal, type RiskState, type SymbolSignals, type Verdict } from "@/lib/risk/verdict";
import { sessionFreeCapital } from "@/lib/venues/paper";
import { VenueError, type Venue } from "@/lib/venues/types";
import { dailyUsage } from "./limits";
import { announceExit, exitPosition, haltSession, isUnknownOrder, orderId, sessionPriceOf, venueFor } from "./exits";
import type { Mandate } from "./mandate";
import { post } from "./room";
import { mandateOf, markOpen, sessionMoney } from "./view";

/** |move| since the last cycle that triggers an early cycle, and below which a quiet interval cycle is skipped. */
export const EVENT_MOVE = 0.015;
export const QUIET_MOVE = 0.002;
export const MAX_SKIPS = 2;
export const FAILS_TO_PAUSE = 3;
export const RETRY_AFTER_FAIL_MS = 2 * 60_000;
/** With no open position, the debate and strategist run only if a market note is directional at this confidence. */
export const SETUP_CONFIDENCE = 0.6;

/** Symbols the market analyst reads as directional with enough confidence to be worth a strategist call. */
export function setupCandidates(market: AnalystNotes): string[] {
  return market.notes.filter((n) => n.stance !== "neutral" && n.confidence >= SETUP_CONFIDENCE).map((n) => n.symbol);
}

export interface CycleDeps {
  ai?: AiFn;
  priceOf?: PriceOf;
  now?: Date;
  gather?: (symbol: string, marketType: Mandate["marketType"]) => Promise<SymbolContext>;
  telegram?: Telegram | null;
  venue?: Venue;
  /** Run even if not due (tests / "run now"). */
  force?: boolean;
}

export interface CycleResult { ran: boolean; skipped?: string; decisions: number; executed: number }

const inFlight = new Set<string>();

type Loaded = TradingSession & { positions: SessionPosition[] };

/** Entries stop this close to the end so positions are not opened only to be closed by the session end. */
export const noEntryWindowMin = (m: Mandate) => Math.min(15, Math.max(5, Math.round(m.durationMin * 0.1)));

function notesBody(label: string, n: AnalystNotes) {
  if (!n.notes.length) return `${label}: no notes.`;
  return n.notes.map((x) => `${x.symbol} — ${x.stance} (${Math.round(x.confidence * 100)}%): ${x.summary}${x.keyPoints.length ? `\n• ${x.keyPoints.join("\n• ")}` : ""}`).join("\n\n");
}

function proposalBody(p: Proposal) {
  const verb = { OPEN_LONG: "Open long", OPEN_SHORT: "Open short", CLOSE: "Close", TIGHTEN_STOP: "Tighten stop on", HOLD: "Hold" }[p.action];
  const levels = p.action === "OPEN_LONG" || p.action === "OPEN_SHORT"
    ? ` · stop ${p.exitPlan.stopLoss == null ? "none" : fmt(p.exitPlan.stopLoss)} · target ${p.exitPlan.takeProfit == null ? "none" : fmt(p.exitPlan.takeProfit)}`
    : p.action === "TIGHTEN_STOP" && p.exitPlan.stopLoss != null ? ` → ${fmt(p.exitPlan.stopLoss)}` : "";
  return `${verb} ${p.symbol}${levels} · conviction ${Math.round(p.conviction * 100)}%\n${p.thesis}${p.exitPlan.invalidation ? `\nInvalidation: ${p.exitPlan.invalidation}` : ""}`;
}

function verdictBody(p: Proposal, v: Verdict) {
  const head = {
    approved: `Approved ${p.symbol}`, clamped: `Approved ${p.symbol} with a smaller size`, rejected: `Rejected ${p.action.replace("_", " ").toLowerCase()} ${p.symbol}`,
    close: `Approved close of ${p.symbol}`, tighten: `Approved new stop on ${p.symbol}`, hold: `Hold ${p.symbol}`,
  }[v.kind];
  const size = v.kind === "approved" || v.kind === "clamped" ? `: ${v.side} ${fmt(v.qty)} (${money(v.margin * v.leverage)} notional, ${money(v.margin)} margin${v.leverage > 1 ? `, ${v.leverage}x` : ""})` : "";
  return `${head}${size}${v.reasons.length ? `\n• ${v.reasons.join("\n• ")}` : ""}`;
}

async function riskState(s: Loaded, priceOf: PriceOf, now: Date): Promise<RiskState> {
  const fresh = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id }, include: { positions: true } });
  const open = fresh.positions.filter((p) => !p.closedAt);
  const marks = await markOpen(open, priceOf);
  const money = sessionMoney(fresh, marks);
  const knownUnrealized = marks.reduce((a, x) => a + (x.unrealized ?? 0), 0);
  const stopOuts: Record<string, number> = {};
  for (const p of fresh.positions) {
    if (p.closedAt && (p.closeReason === "STOP_LOSS" || p.closeReason === "LIQUIDATION"))
      stopOuts[p.symbol] = Math.max(stopOuts[p.symbol] ?? 0, p.closedAt.getTime());
  }
  const daily = await dailyUsage(s.userId, now);
  return {
    equity: money.equity ?? fresh.capital + money.realizedNet + knownUnrealized,
    freeCapital: await sessionFreeCapital(s.id),
    openPositions: open.map((p) => ({
      id: p.id, symbol: p.symbol, side: p.side, qty: p.qty, entryPrice: p.entryPrice, stopLoss: p.stopLoss, margin: p.margin,
      initialStop: (p.exitPlan as { initialStop?: number } | null)?.initialStop ?? null,
    })),
    tradesCount: fresh.tradesCount,
    lastStopOutAt: stopOuts,
    now: now.getTime(),
    dailyLossUsed: daily.lossToday,
    dailyLossLimit: daily.limits.maxDailyLoss,
    sessionLoss: money.lossUsed ?? Math.max(0, -money.realizedNet),
  };
}

async function buildContext(s: Loaded, m: Mandate, symbols: SymbolContext[], priceOf: PriceOf, now: Date): Promise<ContextData> {
  const open = s.positions.filter((p) => !p.closedAt);
  const marks = await markOpen(open, priceOf);
  const money = sessionMoney(s, marks);
  const lessons = await prisma.tradeLesson.findMany({
    where: { userId: s.userId, journalEntry: { pnlSource: "SESSION" } }, orderBy: { createdAt: "desc" }, take: 5,
    select: { outcome: true, symbol: true, lesson: true },
  });
  const positions: PositionContext[] = marks.map(({ pos, mark, unrealized }) => {
    const plan = (pos.exitPlan ?? {}) as { thesis?: string; invalidation?: string; horizonMin?: number };
    return {
      id: pos.id, symbol: pos.symbol, side: pos.side, qty: pos.qty, entryPrice: pos.entryPrice, mark, unrealizedPnl: unrealized,
      stopLoss: pos.stopLoss, takeProfit: pos.takeProfit, thesis: plan.thesis ?? "", invalidation: plan.invalidation ?? "",
      horizonMin: plan.horizonMin ?? 0, ageMin: Math.round((now.getTime() - pos.openedAt.getTime()) / 60_000),
    };
  });
  return {
    now: now.toISOString().slice(0, 16),
    mandate: m,
    usage: {
      equity: money.equity, freeCapital: await sessionFreeCapital(s.id), lossUsed: money.lossUsed ?? Math.max(0, -money.realizedNet), lossLimit: m.lossLimit,
      tradesUsed: s.tradesCount, maxTrades: m.maxTrades, openPositions: open.length, maxOpenPositions: m.maxOpenPositions,
      timeLeftMin: Math.max(0, Math.round((s.endsAt.getTime() - now.getTime()) / 60_000)), llmCostUsd: s.llmCostUsd, maxLlmCostUsd: m.maxLlmCostUsd,
    },
    symbols,
    positions,
    lessons: lessons.map((l) => `[${l.outcome} ${l.symbol}] ${l.lesson}`),
  };
}

/** What the risk engine reads from a symbol's market context (1H ATR, 4H trend). */
export function signalsOf(c: SymbolContext | undefined): SymbolSignals {
  const tf = (name: string) => c?.timeframes.find((t) => t.timeframe === name && t.available);
  return { atr1h: tf("1H")?.atr ?? null, trend4h: tf("4H")?.trend ?? null };
}

/** One decision cycle (spec §4.4): analysts → (debate) → strategist → risk → execution, all posted in the room. */
export async function runCycle(sessionId: string, deps: CycleDeps = {}): Promise<CycleResult> {
  if (inFlight.has(sessionId)) return { ran: false, skipped: "in flight", decisions: 0, executed: 0 };
  inFlight.add(sessionId);
  try {
    return await cycle(sessionId, deps);
  } finally {
    inFlight.delete(sessionId);
  }
}

async function cycle(sessionId: string, deps: CycleDeps): Promise<CycleResult> {
  const now = deps.now ?? new Date();
  const ai = deps.ai ?? (aiJson as AiFn);
  const gather = deps.gather ?? gatherSymbol;
  const none = (skipped: string): CycleResult => ({ ran: false, skipped, decisions: 0, executed: 0 });

  const s = await prisma.tradingSession.findUnique({ where: { id: sessionId }, include: { positions: true } });
  if (!s || s.status !== "RUNNING") return none("not running");
  const priceOf = deps.priceOf ?? (await sessionPriceOf(s, livePrice));
  if (s.llmBudgetHit) return none("ai budget used");
  const m = mandateOf(s);
  const interval = m.decisionIntervalMin * 60_000;

  // Triggers.
  const prices = Object.fromEntries(await Promise.all(m.symbols.map(async (x) => [x, await priceOf(x).catch(() => null)] as const)));
  const last = (s.lastPrices ?? {}) as Record<string, number | null>;
  const moves = m.symbols.map((x) => (prices[x] != null && last[x] ? Math.abs(prices[x]! - last[x]!) / last[x]! : 0));
  const maxMove = Math.max(0, ...moves);
  const closedSince = s.positions.some((p) => p.closedAt && (!s.lastCycleAt || p.closedAt > s.lastCycleAt));
  const due = deps.force || !s.nextCycleAt || s.nextCycleAt <= now;
  const event = s.cycleCount > 0 && (closedSince || maxMove >= EVENT_MOVE);
  if (!due && !event) return none("not due");

  const openCount = s.positions.filter((p) => !p.closedAt).length;
  // Skip only after a completed cycle that decided to hold — never after an agent failure.
  if (!deps.force && !event && s.cycleCount > 0 && s.agentFailStreak === 0 && openCount === 0 && maxMove < QUIET_MOVE && s.skipStreak < MAX_SKIPS) {
    const traded = s.lastCycleAt ? await prisma.sessionOrder.count({ where: { sessionId, purpose: "ENTRY", createdAt: { gte: s.lastCycleAt } } }) : 1;
    if (traded === 0) {
      await prisma.tradingSession.update({ where: { id: sessionId }, data: { nextCycleAt: new Date(now.getTime() + interval), skipStreak: { increment: 1 } } });
      await post(sessionId, "SYSTEM", "TEXT", `Quiet market (moves under ${QUIET_MOVE * 100}% since the last cycle, no positions) — skipped this AI call.`);
      return none("quiet");
    }
  }

  const cycleNo = s.cycleCount + 1;
  const extra = { cycle: cycleNo };
  let cost = 0;
  const addCost = async (c: number) => {
    cost += c;
    await prisma.tradingSession.update({ where: { id: sessionId }, data: { llmCostUsd: { increment: c } } });
  };
  const schedule = (data: Prisma.TradingSessionUpdateInput = {}) => prisma.tradingSession.update({
    where: { id: sessionId },
    data: { cycleCount: cycleNo, lastCycleAt: now, nextCycleAt: new Date(now.getTime() + interval), lastPrices: prices as Prisma.InputJsonValue, ...data },
  });

  const symbols = await Promise.all(m.symbols.map((x) => gather(x, m.marketType).catch((): SymbolContext => ({ symbol: x, price: null, changePct24h: null, timeframes: [], consensus: null, funding: null, news: [] }))));
  if (symbols.every((x) => x.price == null)) {
    await post(sessionId, "SYSTEM", "ALERT", "Market data unavailable for every symbol — no decisions this cycle.", null, extra);
    await schedule();
    return none("no data");
  }
  // Broker sessions: when no allowed market is open (FX weekend, metals daily break), skip the AI call.
  if (s.venue === "exchange" && !s.positions.some((p) => !p.closedAt)) {
    const v = deps.venue ?? (await venueFor(s, priceOf));
    const open = await Promise.all(m.symbols.map((x) => v.marketRules(x).then((r) => !!r).catch(() => false)));
    if (!open.some(Boolean)) {
      await post(sessionId, "SYSTEM", "TEXT", "Markets closed (or no tradable price) at the broker for every session symbol — no AI call this cycle.", null, extra);
      await schedule();
      return none("markets closed");
    }
  }

  const ctx = await buildContext(s, m, symbols, priceOf, now);
  const agentDeps = { ai, userId: s.userId, mandate: m };
  let proposals: Proposal[];
  try {
    const a = await runAnalysts(agentDeps, ctx);
    await addCost(a.costUsd);
    await post(sessionId, "MARKET", "TEXT", notesBody("Market", a.market), { notes: a.market.notes }, { ...extra, costUsd: a.costUsd / 2 });
    await post(sessionId, "NEWS", "TEXT", notesBody("News", a.news), { notes: a.news.notes }, { ...extra, costUsd: a.costUsd / 2 });
    if (!ctx.positions.length && !setupCandidates(a.market).length) {
      await post(sessionId, "SYSTEM", "TEXT", `No setup: no symbol has a directional technical read at ${Math.round(SETUP_CONFIDENCE * 100)}% confidence or more, and nothing is open — skipped the debate and the strategist this cycle.`, { noSetup: true }, extra);
      await schedule({ skipStreak: 0, agentFailStreak: 0 });
      await budgetCheck(sessionId, m, deps.telegram);
      return { ran: true, skipped: "no setup", decisions: 0, executed: 0 };
    }
    let debate = null;
    if (m.debate) {
      const d = await runDebate(agentDeps, ctx, a.market, a.news);
      await addCost(d.costUsd);
      debate = d.data;
      await post(sessionId, "BULL", "TEXT", d.data.bull, null, { ...extra, costUsd: d.costUsd / 2 });
      await post(sessionId, "BEAR", "TEXT", d.data.bear, null, { ...extra, costUsd: d.costUsd / 2 });
    }
    const st = await runStrategist(agentDeps, ctx, a.market, a.news, debate);
    await addCost(st.costUsd);
    const acting = st.proposals.filter((p) => p.action !== "HOLD");
    await post(sessionId, "STRATEGIST", "TEXT", `${st.commentary || "No commentary."}${acting.length ? "" : "\nDecision: hold — no trades this cycle."}`, null, { ...extra, costUsd: st.costUsd });
    for (const p of acting) await post(sessionId, "STRATEGIST", "PROPOSAL", proposalBody(p), { proposal: p }, extra);
    for (const d of st.dropped) await post(sessionId, "RISK", "VERDICT", `Rejected: ${d}`, { kind: "rejected", reasons: [d] }, extra);
    proposals = acting;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ sessionId, err: msg }, "session agents failed");
    const streak = s.agentFailStreak + 1;
    await post(sessionId, "SYSTEM", "ALERT", `Agent error (${msg.slice(0, 200)}) — no trades this cycle.`, null, extra);
    // Retry sooner than a full interval: the failure says nothing about the market.
    await schedule({ agentFailStreak: streak, skipStreak: 0, nextCycleAt: new Date(now.getTime() + Math.min(interval, RETRY_AFTER_FAIL_MS)) });
    if (streak >= FAILS_TO_PAUSE) {
      await prisma.tradingSession.updateMany({ where: { id: sessionId, status: "RUNNING" }, data: { status: "PAUSED" } });
      await post(sessionId, "SYSTEM", "ALERT", `Paused after ${streak} failed cycles in a row. Stops stay active; resume when the AI provider is healthy.`);
      await notify(s.userId, { type: "session", title: s.name, body: `Paused after ${streak} failed AI cycles.`, data: { sessionId, href: `/sessions/${sessionId}` } }, deps.telegram).catch(() => undefined);
    }
    await budgetCheck(sessionId, m, deps.telegram);
    return { ran: true, skipped: "agent error", decisions: 0, executed: 0 };
  }

  // Risk + execution, one decision at a time against fresh state.
  const venue = deps.venue ?? (await venueFor(s, priceOf));
  let executed = 0;
  for (const [i, p] of proposals.entries()) {
    const current = await prisma.tradingSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true, endsAt: true } });
    const opening = p.action === "OPEN_LONG" || p.action === "OPEN_SHORT";
    let v: Verdict;
    if (opening && current.status !== "RUNNING") v = { kind: "rejected", reasons: [`session is ${current.status.toLowerCase().replace("_", " ")} — no new entries`] };
    else if (opening && current.endsAt.getTime() - now.getTime() < noEntryWindowMin(m) * 60_000) v = { kind: "rejected", reasons: [`less than ${noEntryWindowMin(m)} min left in the session — no new entries`] };
    else v = evaluateProposal(p, m, await riskState(s, priceOf, now), await venue.marketRules(p.symbol), signalsOf(symbols.find((x) => x.symbol === p.symbol)));
    if (v.kind === "hold") continue;
    await post(sessionId, "RISK", "VERDICT", verdictBody(p, v), { kind: v.kind, reasons: v.reasons, symbol: p.symbol, action: p.action }, extra);
    try {
      if (v.kind === "approved" || v.kind === "clamped") {
        const r = await venue.openPosition({
          sessionId, clientOrderId: orderId(sessionId, `c${cycleNo}-${i}`), symbol: p.symbol, side: v.side, qty: v.qty, leverage: v.leverage,
          stopLoss: v.stopLoss, takeProfit: v.takeProfit,
          exitPlan: {
            thesis: p.thesis, invalidation: p.exitPlan.invalidation, horizonMin: p.exitPlan.horizonMin, conviction: p.conviction, initialStop: v.stopLoss, takeProfit: v.takeProfit,
            atr1hAtEntry: signalsOf(symbols.find((x) => x.symbol === p.symbol)).atr1h,
          },
        });
        if (!r.replayed) {
          executed++;
          const stopNote = r.stop?.mode === "native" ? " (stop order resting on the exchange)" : r.stop?.error ? ` (exchange stop refused: ${r.stop.error.slice(0, 80)} — software stop active)` : "";
          const body = `${v.side === "LONG" ? "Bought" : "Sold short"} ${fmt(r.fill.qty)} ${p.symbol} at ${fmt(r.fill.price)} · fee ${money(r.fill.fee)} · stop ${fmt(v.stopLoss)}${stopNote}${v.takeProfit != null ? ` · target ${fmt(v.takeProfit)}` : ""}`;
          await post(sessionId, "EXECUTOR", "FILL", body, { positionId: r.positionId, side: v.side, qty: r.fill.qty, price: r.fill.price, fee: r.fill.fee }, extra);
          await notify(s.userId, { type: "session", title: `${s.name}: ${v.side} ${p.symbol}`, body, data: { sessionId, href: `/sessions/${sessionId}` } }, deps.telegram).catch(() => undefined);
        }
      } else if (v.kind === "close") {
        const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: v.positionId } });
        if (await exitPosition(s, pos, "STRATEGIST", { priceOf, telegram: deps.telegram, venue, tag: `c${cycleNo}-${i}`, cycle: cycleNo })) executed++;
      } else if (v.kind === "tighten") {
        const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: v.positionId } });
        const fired = await venue.setStop(v.positionId, v.stopLoss);
        if (fired) {
          await announceExit(s, pos, "STOP_LOSS", fired, { cycle: cycleNo, telegram: deps.telegram, onExchange: true });
          continue;
        }
        await prisma.sessionPosition.update({ where: { id: v.positionId }, data: { exitPlan: { ...(pos.exitPlan as object), invalidation: p.exitPlan.invalidation || (pos.exitPlan as { invalidation?: string }).invalidation } } });
        await post(sessionId, "EXECUTOR", "ORDER", `${p.symbol} stop moved ${pos.stopLoss == null ? "" : `${fmt(pos.stopLoss)} → `}${fmt(v.stopLoss)}.`, { positionId: v.positionId, stopLoss: v.stopLoss }, extra);
        executed++;
      }
    } catch (e) {
      const msg = e instanceof VenueError ? e.message : e instanceof Error ? e.message : String(e);
      await post(sessionId, "SYSTEM", "ALERT", `Execution failed for ${p.symbol}: ${msg}`, null, extra);
      if (isUnknownOrder(e)) {
        await haltSession(s, "RECONCILE_MISMATCH", msg, deps.telegram);
        break;
      }
    }
  }

  await schedule({ skipStreak: 0, agentFailStreak: 0 });
  await budgetCheck(sessionId, m, deps.telegram);
  logger.info({ sessionId, cycle: cycleNo, decisions: proposals.length, executed, costUsd: cost }, "session cycle");
  return { ran: true, decisions: proposals.length, executed };
}

async function budgetCheck(sessionId: string, m: Mandate, telegram?: Telegram | null) {
  const s = await prisma.tradingSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (s.llmBudgetHit || s.llmCostUsd < m.maxLlmCostUsd) return;
  await prisma.tradingSession.update({ where: { id: sessionId }, data: { llmBudgetHit: true } });
  const body = `AI budget reached (${money(s.llmCostUsd)} of ${money(m.maxLlmCostUsd)}). No more decision cycles; stops, targets and the loss limit stay active until the session ends.`;
  await post(sessionId, "SYSTEM", "ALERT", body);
  await notify(s.userId, { type: "session", title: s.name, body, data: { sessionId, href: `/sessions/${sessionId}` } }, telegram).catch(() => undefined);
}
