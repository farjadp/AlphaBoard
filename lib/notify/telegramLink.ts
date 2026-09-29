import "server-only";
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { parseCommand, telegramFromEnv, type Telegram } from "./telegram";
import { BOT_HELP, handleCallback, handleSessionCommand } from "./telegramBot";

const OFFSET_KEY = "telegram.offset";
const CODE_TTL_MS = 15 * 60_000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

let cachedUsername: string | null = null;

async function botUsername(tg: Telegram) {
  if (!cachedUsername) cachedUsername = await tg.username().catch(() => null);
  return cachedUsername;
}

export async function telegramStatus(userId: string, tg: Telegram | null = telegramFromEnv()) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { telegramChatId: true, telegramLinkCode: true, telegramLinkExpires: true } });
  const pending = u.telegramLinkCode && u.telegramLinkExpires && u.telegramLinkExpires > new Date() ? u.telegramLinkCode : null;
  const username = tg ? await botUsername(tg) : null;
  return {
    configured: !!tg,
    linked: !!u.telegramChatId,
    pendingCode: pending,
    botUsername: username,
    deepLink: pending && username ? `https://t.me/${username}?start=${pending}` : null,
  };
}

/** One-time code the user sends to the bot as `/start CODE` (valid 15 minutes). */
export async function startTelegramLink(userId: string, tg: Telegram | null = telegramFromEnv()) {
  const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  await prisma.user.update({ where: { id: userId }, data: { telegramLinkCode: code, telegramLinkExpires: new Date(Date.now() + CODE_TTL_MS) } });
  return telegramStatus(userId, tg);
}

export async function unlinkTelegram(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { telegramChatId: null, telegramLinkCode: null, telegramLinkExpires: null } });
}

/**
 * Called by the worker's long-poll loop: `/start CODE` and `/stop` linking, session commands from linked
 * chats, and inline-button callbacks. The offset is stored so every update is handled once.
 */
export async function processTelegramUpdates(tg: Telegram, now = new Date(), timeoutSec = 0) {
  const row = await prisma.appSetting.findUnique({ where: { key: OFFSET_KEY } });
  const offset = typeof row?.value === "number" ? row.value : 0;
  const updates = await tg.updates(offset, timeoutSec);
  let linked = 0;
  for (const u of updates) {
    if (!u.chatId) continue;
    try {
      if (u.callback) {
        await handleCallback(u, tg, now);
        continue;
      }
      const cmd = parseCommand(u.text);
      if (cmd.type !== "link" && cmd.type !== "unlink") {
        const owner = await prisma.user.findFirst({ where: { telegramChatId: u.chatId }, select: { id: true } });
        if (owner) {
          await handleSessionCommand(cmd, u.chatId, owner.id, tg);
          continue;
        }
      }
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "telegram update failed");
      continue;
    }
    const cmd = parseCommand(u.text);
    let reply: string;
    if (cmd.type === "link") {
      const user = await prisma.user.findFirst({ where: { telegramLinkCode: cmd.code, telegramLinkExpires: { gt: now } }, select: { id: true } });
      if (user) {
        await prisma.$transaction([
          prisma.user.updateMany({ where: { telegramChatId: u.chatId, NOT: { id: user.id } }, data: { telegramChatId: null } }),
          prisma.user.update({ where: { id: user.id }, data: { telegramChatId: u.chatId, telegramLinkCode: null, telegramLinkExpires: null } }),
        ]);
        linked++;
        reply = `✅ Linked. AlphaBoard alerts and session controls will arrive in this chat.\n\n${BOT_HELP}`;
      } else {
        reply = "That code is invalid or expired. Create a new one in AlphaBoard → Settings → Telegram.";
      }
    } else if (cmd.type === "unlink") {
      const res = await prisma.user.updateMany({ where: { telegramChatId: u.chatId }, data: { telegramChatId: null } });
      reply = res.count ? "Unlinked. You will no longer receive AlphaBoard alerts here." : "This chat is not linked to an AlphaBoard account.";
    } else {
      reply = "To link this chat, open AlphaBoard → Settings → Telegram and send the /start code shown there.";
    }
    await tg.send(u.chatId, reply).catch((e) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, "telegram reply failed"));
  }
  if (updates.length) {
    const next = Math.max(...updates.map((u) => u.updateId)) + 1;
    const value = next as Prisma.InputJsonValue;
    await prisma.appSetting.upsert({ where: { key: OFFSET_KEY }, create: { key: OFFSET_KEY, value }, update: { value } });
  }
  return { updates: updates.length, linked };
}
