import { describe, it, expect } from "vitest";
import { DEFAULT_POST_TEMPLATE, displaySymbol, formatSignalPost, renderPost, templateProblems } from "@/lib/signalDesk/format";
import { channelFromEnv } from "@/lib/signalDesk/channel";

const gold = { symbol: "XAUUSD.ec", side: "BUY" as const, entry: 2650.4, stop: 2638, tps: [2656, 2662], riskPct: 0.5, note: null };
const FOOTER = "پیشنهاد سرمایه گذاری نیست. ما سیگنال فروش نیستیم. این دیتا مستقیما از تریدهای خودمان توسط ربات به کانال @gheymat_today ارسال میشود";

describe("default post template", () => {
  it("renders a long like the channel's existing posts", () => {
    expect(formatSignalPost(gold, DEFAULT_POST_TEMPLATE, "gheymat_today")).toBe([
      "XAUUSD",
      "🟢 Long Position",
      "",
      "Entry: 2650.4",
      "",
      "🔥 Risk: 0.5%",
      "⛔️ Stop-Loss: 2638",
      "",
      "TARGETS:",
      "🎯 TP1: 2656",
      "🎯 TP2: 2662",
      "",
      "----",
      FOOTER,
    ].join("\n"));
  });
  it("a market short with a note and no targets drops the empty lines", () => {
    const out = formatSignalPost({ symbol: "SOLUSD.ec", side: "SELL", entry: null, stop: 186, tps: [], riskPct: 1, note: "Under the 4H EMA" }, DEFAULT_POST_TEMPLATE, "gheymat_today");
    expect(out).toContain("🔴 Short Position");
    expect(out).toContain("Entry: Market");
    expect(out).toContain("Under the 4H EMA");
    expect(out).not.toContain("TP1");
    expect(out).not.toMatch(/\n{3,}/);
  });
});

describe("renderPost", () => {
  const t = "{sideEmoji} {side} {symbol} {hashtag}\nEntry {entry} · Stop {stop} ({stopDistance})\nR:R {rr}\n{targets}\n{note}\n{channel}";
  it("fills every field", () => {
    expect(renderPost(t, { ...gold, note: "n" }, "chan")).toBe("🟢 Long XAUUSD #XAUUSD\nEntry 2650.4 · Stop 2638 (−12.4)\nR:R 0.45\n🎯 TP1: 2656\n🎯 TP2: 2662\nn\n@chan");
  });
  it("drops a line whose fields are all empty, keeps static lines", () => {
    expect(renderPost("{symbol}\nR:R {rr}\n{note}\nfixed text", { ...gold, entry: null, tps: [] }, null)).toBe("XAUUSD\nfixed text");
  });
  it("leaves text without fields alone", () => {
    expect(renderPost("{symbol}\n----", gold, null)).toBe("XAUUSD\n----");
  });
});

describe("templateProblems", () => {
  it("accepts the default", () => expect(templateProblems(DEFAULT_POST_TEMPLATE)).toEqual([]));
  it("names unknown fields and missing essentials", () => {
    expect(templateProblems("{symbol} {lev}")).toEqual(["Unknown field {lev}", "The template needs {side} or {sideEmoji}", "The template needs {stop}"]);
  });
  it("limits the length", () => expect(templateProblems("{symbol}{side}{stop}" + "x".repeat(3000))).toContain("The template is too long (max 2000 characters)"));
});

describe("displaySymbol", () => {
  it("strips broker suffixes", () => {
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
