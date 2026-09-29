/** Interactive Telegram against Postgres with a fake bot: commands, buttons, confirmations, permissions. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { parseCommand, type Keyboard, type Telegram, type TgUpdate } from "@/lib/notify/telegram";
import { processTelegramUpdates } from "@/lib/notify/telegramLink";
import { startSession } from "@/lib/sessions/service";
import { paperVenue } from "@/lib/venues/paper";
import { promptExtension } from "@/lib/notify/sessionTelegram";

const run = !!process.env.TEST_DATABASE_URL;

function fakeBot() {
  const inbox: TgUpdate[] = [];
  const sent: Array<{ chatId: string; text: string; keyboard?: Keyboard }> = [];
  const answers: string[] = [];
  const edits: string[] = [];
  let nextId = 1;
  const bot: Telegram = {
    username: async () => "Bot",
    updates: async (offset) => inbox.filter((u) => u.updateId >= offset),
    send: async (chatId, text, keyboard) => { sent.push({ chatId, text, keyboard }); return nextId++; },
    edit: async (_c, _m, text) => { edits.push(text); },
    answer: async (_id, text) => { answers.push(text ?? ""); },
  };
  let upd = 1;
  const say = (chatId: string, text: string) => inbox.push({ updateId: upd++, chatId, text });
  const press = (chatId: string, data: string) => inbox.push({ updateId: upd++, chatId, text: "", callback: { id: `cb${upd}`, data, messageId: 1 } });
  return { bot, sent, answers, edits, say, press };
}

const button = (k: Keyboard | undefined, label: string) => k?.flat().find((b) => b.text.includes(label))?.data ?? "";

describe("parseCommand (session commands)", () => {
  it("recognises session commands and still treats unknown text as help", () => {
    expect(parseCommand("/positions")).toEqual({ type: "positions" });
    expect(parseCommand("/kill@AlphaBoardBot")).toEqual({ type: "kill" });
    expect(parseCommand("/start ABCD1234")).toEqual({ type: "link", code: "ABCD1234" });
    expect(parseCommand("/nope")).toEqual({ type: "help" });
  });
});

describe.skipIf(!run)("telegram session controls (Postgres)", () => {
  let U: string;
  const prices: Record<string, number> = { "BTC/USDT": 100 };
  const priceOf = async (s: string) => prices[s] ?? null;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    U = (await prisma.user.create({ data: { email: "tg@test.local", passwordHash: "x", telegramChatId: "900" } })).id;
    await prisma.user.create({ data: { email: "other@test.local", passwordHash: "x", telegramChatId: "901" } });
  });
  beforeEach(async () => {
    await prisma.tradingSession.deleteMany({});
    await prisma.appSetting.deleteMany({ where: { key: "telegram.offset" } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const start = async () => {
    const s = await startSession(U, { mandate: { symbols: ["BTC/USDT"], capital: 1_000 } }, { priceOf, telegram: null });
    const { positionId } = await paperVenue(priceOf).openPosition({ sessionId: s.id, clientOrderId: `t-${Math.random()}`, symbol: "BTC/USDT", side: "LONG", qty: 2, leverage: 1, stopLoss: 90, takeProfit: 120, exitPlan: { thesis: "t" } });
    return { s, positionId };
  };

  it("/sessions lists the session; kill needs a confirmation; another chat cannot use the button", async () => {
    const { s } = await start();
    const f = fakeBot();
    f.say("900", "/sessions");
    await processTelegramUpdates(f.bot);
    expect(f.sent[0].text).toMatch(/running/);
    const kill = button(f.sent[0].keyboard, "Kill");
    expect(kill).toMatch(/^a:/);

    f.press("901", kill);
    await processTelegramUpdates(f.bot);
    expect(f.answers.at(-1)).toMatch(/not valid/);

    f.press("900", kill);
    await processTelegramUpdates(f.bot);
    expect(f.sent.at(-1)!.text).toMatch(/Kill this session/);
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("RUNNING");

    f.press("900", kill);
    await processTelegramUpdates(f.bot);
    expect(f.answers.at(-1)).toMatch(/Already done/);

    f.press("900", button(f.sent.at(-1)!.keyboard, "Yes"));
    await processTelegramUpdates(f.bot);
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("HALTED");
  });

  it("/positions → close 50% (confirmed) and stop to breakeven", async () => {
    const { positionId } = await start();
    const f = fakeBot();
    f.say("900", "/positions");
    await processTelegramUpdates(f.bot);
    expect(f.sent[0].text).toMatch(/LONG 2 BTC\/USDT/);
    const msg = f.sent[0];
    prices["BTC/USDT"] = 110;
    f.press("900", button(msg.keyboard, "Close 50%"));
    await processTelegramUpdates(f.bot);
    f.press("900", button(f.sent.at(-1)!.keyboard, "Yes"));
    await processTelegramUpdates(f.bot);
    expect((await prisma.sessionPosition.findUniqueOrThrow({ where: { id: positionId } })).qty).toBeCloseTo(1, 10);
    f.press("900", button(msg.keyboard, "SL → BE"));
    await processTelegramUpdates(f.bot);
    const pos = await prisma.sessionPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(pos.stopLoss).toBe(pos.entryPrice);
    expect(f.answers.at(-1)).toMatch(/Stop moved/);
  });

  it("the end-of-session prompt: first button wins, the message is updated", async () => {
    const { s } = await start();
    const f = fakeBot();
    await prisma.tradingSession.update({ where: { id: s.id }, data: { status: "AWAITING_EXTENSION", extensionPromptAt: new Date() } });
    await promptExtension(await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } }), f.bot);
    const prompt = f.sent[0];
    f.press("900", button(prompt.keyboard, "Extend 1h"));
    f.press("900", button(prompt.keyboard, "Close all"));
    await processTelegramUpdates(f.bot);
    const after = await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe("RUNNING");
    expect(after.endsAt.getTime()).toBeGreaterThan(s.endsAt.getTime());
    expect(f.edits[0]).toMatch(/extended by 1h/);
    expect(f.answers.at(-1)).toMatch(/Already done/);
  });

  it("expired buttons are refused", async () => {
    const { s } = await start();
    await prisma.telegramAction.create({ data: { token: "old", userId: U, sessionId: s.id, action: "pause", expiresAt: new Date(Date.now() - 1_000) } });
    const f = fakeBot();
    f.press("900", "a:old");
    await processTelegramUpdates(f.bot);
    expect(f.answers[0]).toMatch(/expired/);
    expect((await prisma.tradingSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("RUNNING");
  });
});
