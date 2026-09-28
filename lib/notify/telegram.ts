/**
 * Minimal Telegram Bot API client (optional delivery, enabled by TELEGRAM_BOT_TOKEN). Linking uses
 * long-poll-free getUpdates from the scheduler tick, so no public webhook URL is needed.
 * The token is part of the Bot API URL path; it is never logged or put in an error message.
 */
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type Command = { type: "link"; code: string } | { type: "unlink" } | { type: "help" };

export function parseCommand(text: string): Command {
  const m = /^\/(start|stop)(?:@\w+)?(?:\s+([A-Za-z0-9]{4,32}))?\s*$/.exec(text.trim());
  if (m?.[1] === "stop") return { type: "unlink" };
  if (m?.[1] === "start" && m[2]) return { type: "link", code: m[2].toUpperCase() };
  return { type: "help" };
}

export const formatAlertMessage = (n: { title: string; body: string }) => `🔔 ${n.title}\n${n.body}`;

export function createTelegram(token: string, fetcher: Fetch = fetch) {
  async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
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
    async updates(offset: number): Promise<Array<{ updateId: number; chatId: string; text: string }>> {
      type U = { update_id: number; message?: { chat?: { id?: number }; text?: string } };
      const rows = await call<U[]>("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
      return rows.flatMap((u) => (u.message?.chat?.id != null && typeof u.message.text === "string"
        ? [{ updateId: u.update_id, chatId: String(u.message.chat.id), text: u.message.text }]
        : [{ updateId: u.update_id, chatId: "", text: "" }]));
    },
    async send(chatId: string, text: string): Promise<void> {
      await call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
    },
  };
}

export type Telegram = ReturnType<typeof createTelegram>;

/** The configured bot, or null when TELEGRAM_BOT_TOKEN is unset (feature off). */
export function telegramFromEnv(): Telegram | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token ? createTelegram(token) : null;
}
