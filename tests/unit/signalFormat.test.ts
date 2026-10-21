import { describe, it, expect } from "vitest";
import { displaySymbol, formatSignalPost } from "@/lib/signals/format";
import { channelFromEnv } from "@/lib/signals/channel";

const gold = { symbol: "XAUUSD.ec", side: "BUY" as const, entry: 2650.4, stop: 2638, tps: [2656, 2662], riskPct: 0.5, note: null };

describe("formatSignalPost", () => {
  it("formats a long with entry, stop distance, TPs and R:R", () => {
    expect(formatSignalPost(gold)).toBe([
      "🟢 LONG XAUUSD",
      "Entry 2650.4",
      "Stop 2638 (−12.4)",
      "🎯 TP1 2656 · TP2 2662",
      "R:R to TP1 0.45 · risk 0.5%",
      "#XAUUSD",
      "Not financial advice.",
    ].join("\n"));
  });
  it("formats a short with a note", () => {
    expect(formatSignalPost({ symbol: "SOLUSD.ec", side: "SELL", entry: 180, stop: 186, tps: [174], riskPct: 1, note: "Under the 4H EMA" })).toBe([
      "🔴 SHORT SOLUSD",
      "Entry 180",
      "Stop 186 (+6)",
      "🎯 TP1 174",
      "R:R to TP1 1 · risk 1%",
      "Under the 4H EMA",
      "#SOLUSD",
      "Not financial advice.",
    ].join("\n"));
  });
  it("formats a market signal without distance or R:R, and no TP line without TPs", () => {
    expect(formatSignalPost({ ...gold, entry: null, tps: [] })).toBe(["🟢 LONG XAUUSD", "Entry market", "Stop 2638", "Risk 0.5%", "#XAUUSD", "Not financial advice."].join("\n"));
  });
  it("strips broker suffixes for display", () => {
    expect(displaySymbol("XAUUSD.ec")).toBe("XAUUSD");
    expect(displaySymbol("XAUUSDm")).toBe("XAUUSD");
    expect(displaySymbol("US30")).toBe("US30");
  });
});

describe("channelFromEnv", () => {
  const ok = (id: number) => new Response(JSON.stringify({ ok: true, result: { message_id: id } }));

  it("is off unless both env vars are set", () => {
    expect(channelFromEnv({ SIGNAL_BOT_TOKEN: "1:x" })).toBeNull();
    expect(channelFromEnv({ SIGNAL_CHANNEL_ID: "-100" })).toBeNull();
  });
  it("posts and replies to the configured channel", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const ch = channelFromEnv({ SIGNAL_BOT_TOKEN: "1:x", SIGNAL_CHANNEL_ID: "-1001" }, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return ok(bodies.length + 40);
    })!;
    expect(await ch.post("hello")).toBe(41);
    expect(await ch.reply(41, "TP1")).toBe(42);
    expect(bodies[0]).toMatchObject({ chat_id: "-1001", text: "hello" });
    expect(bodies[0]).not.toHaveProperty("reply_parameters");
    expect(bodies[1]).toMatchObject({ chat_id: "-1001", text: "TP1", reply_parameters: { message_id: 41, allow_sending_without_reply: true } });
  });
});
