import "server-only";
import { randomBytes } from "node:crypto";
import type { TradingSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import type { Mandate } from "@/lib/sessions/mandate";
import type { Keyboard, Telegram } from "./telegram";

export const ACTION_TTL_MS = 24 * 60 * 60_000;

/** Opaque, single-use token behind an inline button (callback_data = "a:<token>"). */
export async function actionButton(text: string, o: { userId: string; sessionId?: string | null; action: string; positionId?: string | null }, now = new Date()) {
  const token = randomBytes(12).toString("base64url");
  await prisma.telegramAction.create({
    data: { token, userId: o.userId, sessionId: o.sessionId ?? null, action: o.action, positionId: o.positionId ?? null, expiresAt: new Date(now.getTime() + ACTION_TTL_MS) },
  });
  return { text, data: `a:${token}` };
}

async function chatOf(userId: string) {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } }))?.telegramChatId ?? null;
}

/** "Time is up — extend?" with four buttons. Remembers the message so the outcome can be written into it. */
export async function promptExtension(s: Pick<TradingSession, "id" | "userId" | "name" | "mandate">, tg: Telegram | null, now = new Date()) {
  if (!tg) return null;
  const chatId = await chatOf(s.userId);
  if (!chatId) return null;
  const m = s.mandate as unknown as Mandate;
  const keyboard: Keyboard = [
    [await actionButton("Extend 1h", { userId: s.userId, sessionId: s.id, action: "extend:60" }, now), await actionButton("Extend 2h", { userId: s.userId, sessionId: s.id, action: "extend:120" }, now)],
    [await actionButton("Close all", { userId: s.userId, sessionId: s.id, action: "end:CLOSE_ALL" }, now), await actionButton("Keep with stops", { userId: s.userId, sessionId: s.id, action: "end:KEEP_WITH_STOPS" }, now)],
  ];
  const fallback = m.onEnd === "CLOSE_ALL" ? "the session ends and positions are closed" : "the session ends and positions keep their stops";
  const text = `⏰ ${s.name} reached its end time.\nExtend it? If there is no answer within ${m.extensionTimeoutMin} min, ${fallback}.`;
  try {
    const messageId = await tg.send(chatId, text, keyboard);
    if (typeof messageId === "number") {
      await prisma.tradingSession.update({ where: { id: s.id }, data: { extensionChatId: chatId, extensionMessageId: messageId } });
    }
    return messageId ?? null;
  } catch (e) {
    logger.warn({ sessionId: s.id, err: e instanceof Error ? e.message : String(e) }, "extension prompt failed");
    return null;
  }
}

/** Replace the prompt's buttons with the outcome ("Extended by 1h", "No answer — session ended"). */
export async function resolveExtensionPrompt(s: Pick<TradingSession, "id" | "name" | "extensionChatId" | "extensionMessageId">, outcome: string, tg: Telegram | null) {
  if (!tg?.edit || !s.extensionChatId || s.extensionMessageId == null) return;
  await tg.edit(s.extensionChatId, s.extensionMessageId, `⏰ ${s.name}: ${outcome}`).catch(() => undefined);
  await prisma.tradingSession.update({ where: { id: s.id }, data: { extensionChatId: null, extensionMessageId: null } }).catch(() => undefined);
}
