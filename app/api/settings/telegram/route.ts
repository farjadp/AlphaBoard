import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { badRequest } from "@/lib/http/errors";
import { telegramFromEnv } from "@/lib/notify/telegram";
import { startTelegramLink, telegramStatus, unlinkTelegram } from "@/lib/notify/telegramLink";

export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, user) => NextResponse.json(await telegramStatus(user.id)));

/** New one-time link code (replaces any pending one). */
export const POST = userRoute(async (_req, user) => {
  if (!telegramFromEnv()) throw badRequest("Telegram is not configured on this server", "TELEGRAM_NOT_CONFIGURED");
  return NextResponse.json(await startTelegramLink(user.id));
});

export const DELETE = userRoute(async (_req, user) => {
  await unlinkTelegram(user.id);
  return NextResponse.json(await telegramStatus(user.id));
});
