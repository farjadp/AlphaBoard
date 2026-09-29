import "server-only";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { HttpError } from "@/lib/http/errors";
import { fmt, money } from "@/lib/risk/limits";
import {
  closeSessionPosition, endSession, extendSession, killSession, moveStopToBreakeven, pauseSession, resumeSession, sessionView,
} from "@/lib/sessions/service";
import { actionButton } from "./sessionTelegram";
import type { Command, Keyboard, Telegram, TgUpdate } from "./telegram";

const ACTIVE = ["RUNNING", "PAUSED", "AWAITING_EXTENSION"] as const;

export const BOT_HELP = [
  "AlphaBoard bot",
  "/sessions — running sessions with pause / resume / kill",
  "/positions — open positions with close / close 50% / stop to breakeven",
  "/pause, /resume, /kill — control a session",
  "/stop — unlink this chat",
].join("\n");

const statusText = (s: string) => s.toLowerCase().replace("_", " ");
const pnl = (n: number | null) => (n == null ? "unavailable" : `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`);

async function send(tg: Telegram, chatId: string, text: string, keyboard?: Keyboard) {
  await tg.send(chatId, text, keyboard).catch((e) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, "telegram send failed"));
}

async function sessionsMessage(tg: Telegram, chatId: string, userId: string, only?: "pause" | "resume" | "kill") {
  const sessions = await prisma.tradingSession.findMany({ where: { userId, status: { in: [...ACTIVE] } }, orderBy: { startedAt: "asc" } });
  if (!sessions.length) return send(tg, chatId, "No active sessions.");
  for (const s of sessions) {
    const v = await sessionView(userId, s.id);
    const row = [];
    if ((!only || only === "pause") && s.status === "RUNNING") row.push(await actionButton("⏸ Pause", { userId, sessionId: s.id, action: "pause" }));
    if ((!only || only === "resume") && s.status === "PAUSED") row.push(await actionButton("▶ Resume", { userId, sessionId: s.id, action: "resume" }));
    if (!only || only === "kill") row.push(await actionButton("⛔ Kill", { userId, sessionId: s.id, action: "kill" }));
    const text = [
      `${s.name} — ${statusText(s.status)}`,
      `P&L ${pnl(v.equity == null ? null : v.equity - v.capital)} · realized ${pnl(v.netPnl)} · open ${v.meters.openPositions} · trades ${v.meters.trades}/${v.meters.maxTrades}`,
      `Loss ${v.meters.lossUsed == null ? "unavailable" : money(v.meters.lossUsed)} of ${money(v.meters.lossLimit)} · ends ${s.endsAt.toISOString().slice(11, 16)} UTC`,
    ].join("\n");
    await send(tg, chatId, text, row.length ? [row] : undefined);
  }
}

async function positionsMessage(tg: Telegram, chatId: string, userId: string) {
  const sessions = await prisma.tradingSession.findMany({ where: { userId, positions: { some: { closedAt: null } } }, select: { id: true } });
  let count = 0;
  for (const { id } of sessions) {
    const v = await sessionView(userId, id);
    for (const p of v.positions) {
      count++;
      const text = [
        `${p.side} ${fmt(p.qty)} ${p.symbol} — ${v.name}`,
        `Entry ${fmt(p.entryPrice)} · mark ${p.markPrice == null ? "unavailable" : fmt(p.markPrice)} · P&L ${pnl(p.unrealizedPnl)}`,
        `Stop ${p.stopLoss == null ? "none" : fmt(p.stopLoss)} · target ${p.takeProfit == null ? "none" : fmt(p.takeProfit)}`,
      ].join("\n");
      await send(tg, chatId, text, [[
        await actionButton("Close", { userId, sessionId: id, action: "close", positionId: p.id }),
        await actionButton("Close 50%", { userId, sessionId: id, action: "close_half", positionId: p.id }),
        await actionButton("SL → BE", { userId, sessionId: id, action: "be", positionId: p.id }),
      ]]);
    }
  }
  if (!count) await send(tg, chatId, "No open positions.");
}

/** Session commands from a linked chat. */
export async function handleSessionCommand(cmd: Command, chatId: string, userId: string, tg: Telegram) {
  switch (cmd.type) {
    case "sessions": return sessionsMessage(tg, chatId, userId);
    case "positions": return positionsMessage(tg, chatId, userId);
    case "pause": case "resume": case "kill": return sessionsMessage(tg, chatId, userId, cmd.type);
    default: return send(tg, chatId, BOT_HELP);
  }
}

const CONFIRM: Record<string, string> = { kill: "Kill this session: close every position and stop trading?", close: "Close this position at market?", close_half: "Close half of this position at market?" };

/** Inline-button presses. Only the chat linked to the button's owner may use it; tokens are single use and expire. */
export async function handleCallback(u: TgUpdate, tg: Telegram, now = new Date()) {
  const cb = u.callback!;
  const reply = (text: string) => tg.answer?.(cb.id, text.slice(0, 190)).catch(() => undefined);
  const token = cb.data.startsWith("a:") ? cb.data.slice(2) : "";
  const a = token ? await prisma.telegramAction.findUnique({ where: { token }, include: { user: { select: { telegramChatId: true } } } }) : null;
  if (!a || a.user.telegramChatId !== u.chatId) return reply("This button is not valid for this chat.");
  if (a.usedAt) return reply("Already done.");
  if (a.expiresAt < now) return reply("This button has expired — send /sessions or /positions again.");
  const claimed = await prisma.telegramAction.updateMany({ where: { token, usedAt: null }, data: { usedAt: now } });
  if (claimed.count !== 1) return reply("Already done.");

  const [verb, arg] = a.action.split(":");
  try {
    if (CONFIRM[verb] && verb !== "confirm") {
      await send(tg, u.chatId, CONFIRM[verb], [[await actionButton("Yes, do it", { userId: a.userId, sessionId: a.sessionId, action: `confirm:${verb}`, positionId: a.positionId }, now)]]);
      return reply("Confirm below.");
    }
    const action = verb === "confirm" ? arg : verb;
    const sessionId = a.sessionId ?? "";
    switch (action) {
      case "pause": await pauseSession(a.userId, sessionId, { telegram: tg }); return reply("Paused.");
      case "resume": await resumeSession(a.userId, sessionId, { telegram: tg }); return reply("Resumed.");
      case "kill": await killSession(a.userId, sessionId, { telegram: tg }); return reply("Killed — positions closed.");
      case "close": await closeSessionPosition(a.userId, a.positionId ?? "", 1, { telegram: tg }); return reply("Closed.");
      case "close_half": await closeSessionPosition(a.userId, a.positionId ?? "", 0.5, { telegram: tg }); return reply("Half closed.");
      case "be": { const be = await moveStopToBreakeven(a.userId, a.positionId ?? "", { telegram: tg }); return reply(`Stop moved to ${fmt(be)}.`); }
      case "extend":
      case "end": {
        // The four buttons of one prompt: the first press wins.
        await prisma.telegramAction.updateMany({ where: { sessionId, usedAt: null, OR: [{ action: { startsWith: "extend:" } }, { action: { startsWith: "end:" } }] }, data: { usedAt: now } });
        let outcome: string;
        if (action === "extend") {
          const minutes = Number(arg);
          await extendSession(a.userId, sessionId, minutes, { telegram: tg });
          outcome = `extended by ${minutes / 60}h.`;
        } else {
          await endSession(a.userId, sessionId, arg === "KEEP_WITH_STOPS" ? "KEEP_WITH_STOPS" : "CLOSE_ALL", { telegram: tg });
          outcome = arg === "KEEP_WITH_STOPS" ? "ended, positions kept with their stops." : "ended, positions closed.";
        }
        return reply(outcome);
      }
      default: return reply("Unknown action.");
    }
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "That did not work — try again from the web app.";
    if (!(e instanceof HttpError)) logger.warn({ action: a.action, err: e instanceof Error ? e.message : String(e) }, "telegram action failed");
    return reply(msg);
  }
}
