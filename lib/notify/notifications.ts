import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { formatAlertMessage, telegramFromEnv, type Telegram } from "./telegram";

export interface NewNotification {
  type: "price_alert" | "paper_close";
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationDto { id: string; type: string; title: string; body: string; data: unknown; readAt: string | null; createdAt: string }

/**
 * In-app notification, plus Telegram when the user linked a chat and the bot is configured.
 * Telegram is best effort: a failure never loses the in-app notification; a blocked bot unlinks the chat.
 */
export async function notify(userId: string, n: NewNotification, telegram: Telegram | null = telegramFromEnv()) {
  const row = await prisma.notification.create({
    data: { userId, type: n.type, title: n.title, body: n.body, data: (n.data ?? undefined) as Prisma.InputJsonValue | undefined },
  });
  if (telegram) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
    if (user?.telegramChatId) {
      try {
        await telegram.send(user.telegramChatId, formatAlertMessage(n));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn({ userId, err: msg }, "telegram delivery failed");
        if (/blocked|chat not found|deactivated/i.test(msg)) {
          await prisma.user.updateMany({ where: { id: userId, telegramChatId: user.telegramChatId }, data: { telegramChatId: null } });
        }
      }
    }
  }
  return row;
}

const dto = (r: Prisma.NotificationGetPayload<object>): NotificationDto => ({
  id: r.id, type: r.type, title: r.title, body: r.body, data: r.data, readAt: r.readAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
});

export async function listNotifications(userId: string) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: items.map(dto), unread };
}

export async function markNotificationsRead(userId: string, ids: string[] | "all") {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
  return listNotifications(userId);
}
