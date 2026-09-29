import "server-only";
import type { Prisma, TradingSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, HttpError, notFound } from "@/lib/http/errors";
import { livePrice } from "@/lib/paper/account";
import { notify } from "@/lib/notify/notifications";
import type { Telegram } from "@/lib/notify/telegram";
import { formatMandate } from "@/lib/agents/context";
import { fmt, money } from "@/lib/risk/limits";
import type { SessionSummaryDto } from "@/lib/types/sessions";
import { canTransition, isActive } from "./lifecycle";
import { dailyUsage } from "./limits";
import { MandateError, parseMandate } from "./mandate";
import { exitPosition, flatten, venueFor, type ExitDeps } from "./exits";
import { post } from "./room";
import { buildView, mandateOf, summaryToDto } from "./view";

export const MAX_ACTIVE_SESSIONS = 3;
const MAX_EXTENSION_MIN = 24 * 60;

export interface ServiceDeps extends ExitDeps { now?: Date }

type Status = TradingSession["status"];

async function owned(userId: string, id: string) {
  const s = await prisma.tradingSession.findFirst({ where: { id, userId } });
  if (!s) throw notFound("Session not found");
  return s;
}

function transitionOrFail(s: TradingSession, to: Status) {
  if (!canTransition(s.status, to)) throw badRequest(`A ${s.status.toLowerCase().replace("_", " ")} session cannot move to ${to.toLowerCase().replace("_", " ")}`, "BAD_STATE");
}

/** Status change guarded by the current status, so two actors cannot both apply a transition. */
async function setStatus(s: TradingSession, to: Status, data: Prisma.TradingSessionUpdateManyMutationInput = {}) {
  const r = await prisma.tradingSession.updateMany({ where: { id: s.id, status: s.status }, data: { status: to, ...data } });
  if (r.count !== 1) throw new HttpError(409, "The session changed in the meantime — reload and try again", "CONFLICT");
}

const say = (s: Pick<TradingSession, "id" | "userId" | "name">, body: string, telegram?: Telegram | null) =>
  notify(s.userId, { type: "session", title: s.name, body, data: { sessionId: s.id, href: `/sessions/${s.id}` } }, telegram).catch(() => undefined);

export async function startSession(userId: string, input: { name?: string; mandate: unknown; live?: boolean }, deps: ServiceDeps = {}) {
  const now = deps.now ?? new Date();
  const priceOf = deps.priceOf ?? livePrice;
  if (input.live) throw badRequest("Live trading arrives with exchange connections (P8b); sessions run on paper for now", "LIVE_DISABLED");
  let mandate;
  try {
    mandate = parseMandate(input.mandate);
  } catch (e) {
    if (e instanceof MandateError) throw badRequest(e.issues.join(" · "), "BAD_MANDATE");
    throw e;
  }
  const active = await prisma.tradingSession.count({ where: { userId, status: { in: ["RUNNING", "PAUSED", "AWAITING_EXTENSION", "ENDING"] } } });
  if (active >= MAX_ACTIVE_SESSIONS) throw badRequest(`At most ${MAX_ACTIVE_SESSIONS} sessions can run at once`, "TOO_MANY_SESSIONS");
  const usage = await dailyUsage(userId, now);
  if (usage.limits.maxSessionsPerDay != null && usage.sessionsToday >= usage.limits.maxSessionsPerDay)
    throw badRequest(`Daily session limit reached (${usage.sessionsToday}/${usage.limits.maxSessionsPerDay})`, "DAILY_LIMIT");
  if (usage.limits.maxDailyLoss != null && usage.lossToday >= usage.limits.maxDailyLoss)
    throw badRequest(`Daily loss limit reached (${money(usage.lossToday)} of ${money(usage.limits.maxDailyLoss)})`, "DAILY_LIMIT");

  const startPrices = Object.fromEntries(await Promise.all(mandate.symbols.map(async (s) => [s, await priceOf(s).catch(() => null)] as const)));
  const name = (input.name?.trim() || `${mandate.symbols.join(" · ")} · ${Math.round(mandate.durationMin / 60 * 10) / 10}h`).slice(0, 80);
  const s = await prisma.tradingSession.create({
    data: {
      userId, name, mandate: mandate as unknown as Prisma.InputJsonValue, capital: mandate.capital, venue: mandate.venue,
      startedAt: now, endsAt: new Date(now.getTime() + mandate.durationMin * 60_000), nextCycleAt: now,
      startPrices: startPrices as Prisma.InputJsonValue, lastPrices: startPrices as Prisma.InputJsonValue,
    },
  });
  await post(s.id, "SYSTEM", "TEXT", `Session started on paper. The first decision cycle runs within a minute.\n${formatMandate(mandate)}`);
  await say(s, `Session started: ${mandate.symbols.join(", ")}, ${mandate.durationMin} min, loss limit ${money(mandate.lossLimit)}.`, deps.telegram);
  return s;
}

export async function listSessions(userId: string): Promise<SessionSummaryDto[]> {
  const rows = await prisma.tradingSession.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, take: 100,
    include: { _count: { select: { positions: { where: { closedAt: null } } } } },
  });
  return rows.map((r) => summaryToDto(r, r._count.positions));
}

export async function sessionView(userId: string, id: string, deps: ServiceDeps = {}) {
  const s = await prisma.tradingSession.findFirst({ where: { id, userId }, include: { positions: true, report: { select: { id: true } } } });
  if (!s) throw notFound("Session not found");
  return buildView(s, deps.priceOf ?? livePrice, deps.now);
}

export async function pauseSession(userId: string, id: string, deps: ServiceDeps = {}) {
  const s = await owned(userId, id);
  transitionOrFail(s, "PAUSED");
  await setStatus(s, "PAUSED");
  await post(s.id, "USER", "TEXT", "Paused. No new trades; stops and the loss limit stay active.");
  await say(s, "Session paused.", deps.telegram);
}

export async function resumeSession(userId: string, id: string, deps: ServiceDeps = {}) {
  const now = deps.now ?? new Date();
  const s = await owned(userId, id);
  if (s.status !== "PAUSED") throw badRequest("Only a paused session can resume", "BAD_STATE");
  if (s.endsAt <= now) throw badRequest("The session time is up — extend it instead", "BAD_STATE");
  await setStatus(s, "RUNNING", { nextCycleAt: now, agentFailStreak: 0 });
  await post(s.id, "USER", "TEXT", "Resumed.");
  await say(s, "Session resumed.", deps.telegram);
}

export async function extendSession(userId: string, id: string, minutes: number, deps: ServiceDeps = {}) {
  const now = deps.now ?? new Date();
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > MAX_EXTENSION_MIN) throw badRequest("Extend by 5 minutes to 24 hours", "BAD_EXTENSION");
  const s = await owned(userId, id);
  if (!["RUNNING", "PAUSED", "AWAITING_EXTENSION"].includes(s.status)) throw badRequest("Only an active session can be extended", "BAD_STATE");
  const endsAt = new Date(Math.max(s.endsAt.getTime(), now.getTime()) + minutes * 60_000);
  const next: Status = s.status === "AWAITING_EXTENSION" ? "RUNNING" : s.status;
  await setStatus(s, next, { endsAt, extensionPromptAt: null, ...(next === "RUNNING" && s.status !== "RUNNING" ? { nextCycleAt: now } : {}) });
  await post(s.id, "USER", "TEXT", `Extended by ${minutes} min — now ends ${endsAt.toISOString().slice(11, 16)} UTC.`);
  await say(s, `Session extended by ${minutes} min.`, deps.telegram);
  return endsAt;
}

/**
 * Finish a session: CLOSE_ALL flattens now; KEEP_WITH_STOPS leaves positions open with their stops,
 * which the monitor keeps enforcing after the session ends.
 */
export async function finishSession(
  s: TradingSession, reason: NonNullable<TradingSession["endReason"]>, mode: "CLOSE_ALL" | "KEEP_WITH_STOPS", deps: ServiceDeps = {},
) {
  const now = deps.now ?? new Date();
  const halted = reason === "KILL" || reason === "LOSS_LIMIT" || reason === "RECONCILE_MISMATCH" || reason === "ERROR";
  await setStatus(s, halted ? "HALTED" : "ENDED", { endReason: reason, endedAt: now, extensionPromptAt: null, nextCycleAt: null });
  const closeReason = reason === "KILL" ? "KILL" : reason === "LOSS_LIMIT" ? "LOSS_LIMIT" : "SESSION_END";
  const r = mode === "CLOSE_ALL" || halted ? await flatten(s, closeReason, deps) : { closed: 0, failed: [] };
  const open = await prisma.sessionPosition.count({ where: { sessionId: s.id, closedAt: null } });
  const text = {
    COMPLETED: "Session completed.", USER_ENDED: "Session ended by you.", EXTENSION_TIMEOUT: "No answer to the extension prompt — session ended.",
    KILL: "Kill switch: all orders cancelled and positions closed.", LOSS_LIMIT: "Session loss limit reached — trading halted and positions closed.",
    LLM_BUDGET: "AI budget used up — session ended.", RECONCILE_MISMATCH: "Venue state did not match — trading halted.", ERROR: "Session halted after repeated errors.",
  }[reason];
  const tail = open ? ` ${open} position(s) remain open${mode === "KEEP_WITH_STOPS" && !halted ? " with their stops (still enforced)" : " — retrying the close"}.` : r.closed ? ` Closed ${r.closed} position(s).` : "";
  await post(s.id, "SYSTEM", "ALERT", `${text}${tail} The report follows once every position is closed.`);
  await say(s, `${text}${tail}`, deps.telegram);
}

export async function endSession(userId: string, id: string, mode: "CLOSE_ALL" | "KEEP_WITH_STOPS", deps: ServiceDeps = {}) {
  const s = await owned(userId, id);
  if (!isActive(s.status)) throw badRequest("The session has already ended", "BAD_STATE");
  await post(s.id, "USER", "TEXT", mode === "CLOSE_ALL" ? "End the session and close all positions." : "End the session and keep positions with their stops.");
  await finishSession(s, "USER_ENDED", mode, deps);
}

export async function killSession(userId: string, id: string, deps: ServiceDeps = {}) {
  const s = await owned(userId, id);
  if (s.status === "HALTED" || s.status === "ENDED") {
    // A kill after the end still flattens anything left open (e.g. KEEP_WITH_STOPS).
    await post(s.id, "USER", "TEXT", "Kill: close everything that is still open.");
    return flatten(s, "KILL", deps);
  }
  await post(s.id, "USER", "TEXT", "Kill switch.");
  await finishSession(s, "KILL", "CLOSE_ALL", deps);
}

async function ownedOpenPosition(userId: string, positionId: string) {
  const pos = await prisma.sessionPosition.findFirst({ where: { id: positionId, session: { userId } }, include: { session: true } });
  if (!pos) throw notFound("Position not found");
  if (pos.closedAt) throw badRequest("Position is already closed", "CLOSED");
  return pos;
}

export async function closeSessionPosition(userId: string, positionId: string, fraction = 1, deps: ServiceDeps = {}) {
  if (!(fraction > 0 && fraction <= 1)) throw badRequest("Close 1–100% of a position", "BAD_FRACTION");
  const pos = await ownedOpenPosition(userId, positionId);
  await post(pos.sessionId, "USER", "TEXT", fraction < 1 ? `Close ${Math.round(fraction * 100)}% of ${pos.side} ${pos.symbol}.` : `Close ${pos.side} ${pos.symbol}.`);
  try {
    const r = await exitPosition(pos.session, pos, "MANUAL", { ...deps, fraction });
    if (!r) throw badRequest("Position is already closed", "CLOSED");
    return r;
  } catch (e) {
    if (e instanceof Error && e.name === "VenueError") throw new HttpError(503, e.message, "PRICE_UNAVAILABLE");
    throw e;
  }
}

export async function moveStopToBreakeven(userId: string, positionId: string, deps: ServiceDeps = {}) {
  const pos = await ownedOpenPosition(userId, positionId);
  const price = await (deps.priceOf ?? livePrice)(pos.symbol);
  if (price == null) throw new HttpError(503, `${pos.symbol} price unavailable`, "PRICE_UNAVAILABLE");
  const be = pos.entryPrice;
  const long = pos.side === "LONG";
  if (long ? price <= be : price >= be) throw badRequest(`Price ${fmt(price)} has not moved past the entry ${fmt(be)} yet`, "NOT_IN_PROFIT");
  if (pos.stopLoss != null && (long ? pos.stopLoss >= be : pos.stopLoss <= be)) throw badRequest("The stop is already at or beyond breakeven", "ALREADY_PROTECTED");
  await venueFor(pos.session, deps.priceOf).setStop(pos.id, be);
  await post(pos.sessionId, "USER", "TEXT", `Move ${pos.symbol} stop to breakeven (${fmt(be)}).`);
  await post(pos.sessionId, "EXECUTOR", "ORDER", `${pos.symbol} stop moved ${pos.stopLoss == null ? "" : `${fmt(pos.stopLoss)} → `}${fmt(be)}.`, { positionId: pos.id, stopLoss: be });
  return be;
}

export { mandateOf };
