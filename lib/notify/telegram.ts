/**
 * Minimal Telegram Bot API client (optional delivery, enabled by TELEGRAM_BOT_TOKEN). The worker
 * long-polls getUpdates (messages + inline-button callbacks), so no public webhook URL is needed.
 * The token is part of the Bot API URL path; it is never logged or put in an error message.
 */
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type Command =
  | { type: "link"; code: string }
  | { type: "unlink" }
  | { type: "help" }
  | { type: "sessions" | "positions" | "pause" | "resume" | "kill" };

const SESSION_COMMANDS = new Set(["sessions", "positions", "pause", "resume", "kill"]);

export function parseCommand(text: string): Command {
  const t = text.trim();
  const m = /^\/(start|stop)(?:@\w+)?(?:\s+([A-Za-z0-9]{4,32}))?\s*$/.exec(t);
  if (m?.[1] === "stop") return { type: "unlink" };
  if (m?.[1] === "start" && m[2]) return { type: "link", code: m[2].toUpperCase() };
  const c = /^\/([a-z]+)(?:@\w+)?\s*$/.exec(t)?.[1];
  if (c && SESSION_COMMANDS.has(c)) return { type: c as "sessions" };
  return { type: "help" };
}

export const formatAlertMessage = (n: { title: string; body: string }) => `🔔 ${n.title}\n${n.body}`;

export type Keyboard = Array<Array<{ text: string; data: string }>>;

export interface TgUpdate {
  updateId: number;
  /** "" for updates this bot ignores (still acknowledged via the offset). */
  chatId: string;
  text: string;
  callback?: { id: string; data: string; messageId: number | null };
}

export interface Telegram {
  username(): Promise<string>;
  /** getUpdates; timeoutSec > 0 long-polls. */
  updates(offset: number, timeoutSec?: number): Promise<TgUpdate[]>;
  /** Returns the sent message id when the API reports it. */
  send(chatId: string, text: string, keyboard?: Keyboard): Promise<number | void>;
  edit?(chatId: string, messageId: number, text: string, keyboard?: Keyboard): Promise<void>;
  answer?(callbackId: string, text?: string): Promise<void>;
}

const markup = (keyboard?: Keyboard) =>
  keyboard ? { reply_markup: { inline_keyboard: keyboard.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {};

export function createTelegram(token: string, fetcher: Fetch = fetch): Telegram {
  async function call<T>(method: string, body?: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
    let res: Response;
    try {
      res = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(`telegram ${method}: network error (${e instanceof Error ? e.name : "unknown"})`);
    }
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !json?.ok) throw new Error(`telegram ${method}: ${json?.description ?? `HTTP ${res.status}`}`);
    return json.result as T;
  }

  return {
    async username(): Promise<string> {
      return (await call<{ username: string }>("getMe")).username;
    },
    async updates(offset: number, timeoutSec = 0): Promise<TgUpdate[]> {
      type U = {
        update_id: number;
        message?: { chat?: { id?: number }; text?: string };
        callback_query?: { id: string; data?: string; message?: { message_id?: number; chat?: { id?: number } } };
      };
      const rows = await call<U[]>("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] }, (timeoutSec + 10) * 1_000);
      return rows.map((u): TgUpdate => {
        const cq = u.callback_query;
        if (cq?.message?.chat?.id != null && typeof cq.data === "string")
          return { updateId: u.update_id, chatId: String(cq.message.chat.id), text: "", callback: { id: cq.id, data: cq.data, messageId: cq.message.message_id ?? null } };
        if (u.message?.chat?.id != null && typeof u.message.text === "string") return { updateId: u.update_id, chatId: String(u.message.chat.id), text: u.message.text };
        return { updateId: u.update_id, chatId: "", text: "" };
      });
    },
    async send(chatId: string, text: string, keyboard?: Keyboard): Promise<number> {
      const r = await call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...markup(keyboard) });
      return r?.message_id;
    },
    async edit(chatId: string, messageId: number, text: string, keyboard?: Keyboard): Promise<void> {
      await call("editMessageText", { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true, ...markup(keyboard) });
    },
    async answer(callbackId: string, text?: string): Promise<void> {
      await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
    },
  };
}

/** The configured bot, or null when TELEGRAM_BOT_TOKEN is unset (feature off). */
export function telegramFromEnv(): Telegram | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token ? createTelegram(token) : null;
}
