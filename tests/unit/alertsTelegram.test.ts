import { describe, it, expect } from "vitest";
import { alertHit } from "@/lib/alerts/evaluate";
import { createTelegram, parseCommand, formatAlertMessage } from "@/lib/notify/telegram";

const bar = (time: number, open: number, high: number, low: number) => ({ time, open, high, low, close: open });

describe("alertHit", () => {
  const above = { condition: "above" as const, targetPrice: 100 };
  const below = { condition: "below" as const, targetPrice: 100 };
  it("fires on the candle high/low crossing the level, not only the last price", () => {
    expect(alertHit(above, [bar(2_000, 98, 101, 97)], 1_000)).toEqual({ at: 2_000, price: 100 });
    expect(alertHit(below, [bar(2_000, 102, 103, 99)], 1_000)).toEqual({ at: 2_000, price: 100 });
  });
  it("reports the open when price gapped through the level", () => {
    expect(alertHit(above, [bar(2_000, 104, 105, 103)], 1_000)).toEqual({ at: 2_000, price: 104 });
  });
  it("ignores candles that started before the alert was checked last, and misses", () => {
    expect(alertHit(above, [bar(500, 98, 150, 97)], 1_000)).toBeNull();
    expect(alertHit(above, [bar(2_000, 98, 99.9, 97)], 1_000)).toBeNull();
  });
  it("takes the earliest crossing", () => {
    expect(alertHit(below, [bar(3_000, 99, 99, 98), bar(2_000, 101, 101, 99.5)], 1_000)?.at).toBe(2_000);
  });
});

describe("telegram", () => {
  it("parses /start codes (also the deep-link form) and /stop", () => {
    expect(parseCommand("/start AB12CD34")).toEqual({ type: "link", code: "AB12CD34" });
    expect(parseCommand("/start@AlphaBoardBot ab12cd34")).toEqual({ type: "link", code: "AB12CD34" });
    expect(parseCommand("/stop")).toEqual({ type: "unlink" });
    expect(parseCommand("/start")).toEqual({ type: "help" });
    expect(parseCommand("hello")).toEqual({ type: "help" });
  });

  it("calls the Bot API with JSON and surfaces API errors without leaking the token", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const tg = createTelegram("123:SECRET", async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).endsWith("/getMe")) return new Response(JSON.stringify({ ok: true, result: { username: "AlphaBoardBot" } }));
      if (String(url).endsWith("/sendMessage")) return new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
      return new Response(JSON.stringify({ ok: true, result: [{ update_id: 7, message: { chat: { id: 42 }, text: "/start X" } }] }));
    });
    expect(await tg.username()).toBe("AlphaBoardBot");
    expect(await tg.updates(5)).toEqual([{ updateId: 7, chatId: "42", text: "/start X" }]);
    expect(calls[1].body).toMatchObject({ offset: 5, timeout: 0 });
    const err = await tg.send("42", "hi").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/blocked/);
    expect((err as Error).message).not.toContain("SECRET");
  });

  it("formats alert messages as plain text", () => {
    expect(formatAlertMessage({ title: "BTC/USDT crossed above 85,000", body: "Reached 85,012.40 at 14:02 UTC." }))
      .toBe("🔔 BTC/USDT crossed above 85,000\nReached 85,012.40 at 14:02 UTC.");
  });
});
