import { env as readEnv } from "@/lib/env";
import { createTelegram } from "@/lib/notify/telegram";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The public signals channel (P12): post a signal, then reply under it as the trade plays out. */
export interface Channel {
  post(text: string): Promise<number>;
  reply(messageId: number, text: string): Promise<number>;
}

/**
 * The channel bot from SIGNAL_BOT_TOKEN + SIGNAL_CHANNEL_ID, or null when either is unset (channel off; execution
 * still works). Only sendMessage is used, never getUpdates: this bot is not the worker-polled TELEGRAM_BOT_TOKEN one.
 */
export function channelFromEnv(env: { SIGNAL_BOT_TOKEN?: string; SIGNAL_CHANNEL_ID?: string } = readEnv(), fetcher?: Fetch): Channel | null {
  const token = env.SIGNAL_BOT_TOKEN?.trim();
  const chatId = env.SIGNAL_CHANNEL_ID?.trim();
  if (!token || !chatId) return null;
  const tg = createTelegram(token, fetcher);
  const sent = (id: number | void) => {
    if (typeof id !== "number") throw new Error("telegram sendMessage: no message id");
    return id;
  };
  return {
    post: async (text) => sent(await tg.send(chatId, text)),
    reply: async (messageId, text) => sent(await tg.send(chatId, text, undefined, { replyTo: messageId })),
  };
}
