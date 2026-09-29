/**
 * Data isolation between users against a real Postgres (schema "test").
 * Run with TEST_DATABASE_URL set; skipped otherwise (CI sets it).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createJournalEntry, listJournal, updateJournalEntry, deleteJournalEntry } from "@/lib/db/journal";
import { createAttachment, getAttachment, assertOwnedAttachments } from "@/lib/db/attachments";
import { getWatchlist, setWatchlist } from "@/lib/db/watchlist";
import { createAlert, listAlerts, deleteAlert, markAlertTriggered } from "@/lib/db/alerts";
import { createChartLesson, listChartLessons } from "@/lib/db/chartLessons";
import { saveLesson, listLessons } from "@/lib/db/lessons";
import { importLegacyData } from "@/lib/db/importLegacy";
import { parseLegacyData } from "@/lib/import/legacy";
import { DEFAULT_WATCHLIST } from "@/lib/assetCatalog";

const png = "data:image/png;base64," + Buffer.from("pretend-image-bytes").toString("base64");
const run = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!run)("user data isolation (Postgres)", () => {
  let A: string, B: string;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "a@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "b@test.local", passwordHash: "x" } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("journal entries are invisible and immutable to other users", async () => {
    const entry = await createJournalEntry(A, { symbol: "BTC/USDT", position: "LONG", entryPrice: 100, exitPrice: 110, emotion: "Neutral", notes: "mine" });
    expect(entry.status).toBe("CLOSED");
    expect(entry.pnlPercent).toBeCloseTo(9.9, 6);

    expect(await listJournal(B)).toEqual([]);
    await expect(updateJournalEntry(B, entry.id, { notes: "hacked" })).rejects.toMatchObject({ status: 404 });
    await deleteJournalEntry(B, entry.id);
    const [still] = await listJournal(A);
    expect(still.notes).toBe("mine");
  });

  it("screenshots: uploading via patch stores an attachment; replacing deletes the old one", async () => {
    const entry = await createJournalEntry(A, { symbol: "ETH/USDT", position: "SHORT", entryPrice: 2000, emotion: "FOMO", notes: "" });
    const withShot = await updateJournalEntry(A, entry.id, { screenshotUrl: png });
    const firstId = withShot.screenshotUrl!.split("/").pop()!;
    const replaced = await updateJournalEntry(A, entry.id, { screenshotUrl: png });
    expect(replaced.screenshotUrl).not.toBe(withShot.screenshotUrl);
    expect(await getAttachment(A, firstId)).toBeNull();
  });

  it("attachments cannot be read or referenced by another user", async () => {
    const { id } = await createAttachment(A, png);
    expect(await getAttachment(A, id)).not.toBeNull();
    expect(await getAttachment(B, id)).toBeNull();
    await expect(assertOwnedAttachments(B, [id])).rejects.toMatchObject({ status: 400 });
    // Re-using another user's attachment URL in a chart lesson must not link their image.
    await expect(createChartLesson(B, {
      overallSignal: "BUY", confluenceScore: 50, summary: "", lesson: "", patterns: [], tags: [], mistakes: [], strengths: [],
      charts: [{ timeframe: "4H", imageDataUrl: `/api/attachments/${id}`, annotations: [] }],
    })).rejects.toMatchObject({ status: 400 });
    expect(await listChartLessons(B)).toEqual([]);
  });

  it("watchlists are per user and default until saved", async () => {
    await setWatchlist(A, ["SOL/USDT", "XAU/USD"]);
    expect(await getWatchlist(A)).toEqual(["SOL/USDT", "XAU/USD"]);
    expect(await getWatchlist(B)).toEqual(DEFAULT_WATCHLIST);
    await expect(setWatchlist(B, ["NOT_REAL"])).rejects.toMatchObject({ status: 400 });
  });

  it("alerts: other users cannot delete or trigger them; triggering is idempotent", async () => {
    const alert = await createAlert(A, { symbol: "BTC/USDT", targetPrice: 1, condition: "above" });
    await deleteAlert(B, alert.id);
    expect(await markAlertTriggered(B, alert.id)).toBeNull();
    const first = await markAlertTriggered(A, alert.id);
    const second = await markAlertTriggered(A, alert.id);
    expect(first!.triggered).toBe(true);
    expect(second!.triggeredAt).toBe(first!.triggeredAt);
    expect((await listAlerts(A)).length).toBe(1);
  });

  it("a lesson cannot be attached to someone else's trade", async () => {
    const [aTrade] = await listJournal(A);
    const lesson = await saveLesson(B, { tradeId: aTrade.id, symbol: "BTC/USDT", position: "LONG", outcome: "WIN", rootCause: "", mistakes: [], strengths: [], lesson: "x", tags: [] });
    expect(lesson.tradeId).toBe("");
    expect(await listLessons(A)).toEqual([]);
  });

  it("legacy import is idempotent", async () => {
    const data = parseLegacyData({
      watchlist: ["BTC/USDT"],
      journal: [{ id: "legacy-1", timestamp: "2026-09-01T00:00:00Z", symbol: "BTC/USDT", position: "LONG", entryPrice: 100, exitPrice: 105, emotion: "Neutral", notes: "", status: "CLOSED" }],
      lessons: [{ id: "legacy-l1", tradeId: "legacy-1", symbol: "BTC/USDT", position: "LONG", outcome: "WIN", rootCause: "r", mistakes: [], strengths: [], lesson: "l", tags: [], timestamp: "2026-09-02T00:00:00Z" }],
      signals: [{ id: "legacy-s1", timestamp: "2026-09-01T00:00:00Z", symbol: "BTC/USDT", price: 100, signal: "BUY", confidence: 70, timeframe: "1H", entry: 100, stopLoss: 95, takeProfit: 110, reasoning: "r" }],
    });
    const first = await importLegacyData(B, data);
    const second = await importLegacyData(B, data);
    expect(first).toMatchObject({ journal: 1, lessons: 1, signals: 1, watchlist: 1 });
    expect(second).toMatchObject({ journal: 0, lessons: 0, signals: 0, watchlist: 0 });
    const lesson = (await listLessons(B)).find((l) => l.lesson === "l")!;
    const [trade] = (await listJournal(B)).filter((j) => j.symbol === "BTC/USDT");
    expect(lesson.tradeId).toBe(trade.id);
  });
});

describe.skipIf(!run)("legacy import — images uploaded on a later run", () => {
  it("attaches a screenshot to an already-imported entry and deletes redundant uploads", async () => {
    const user = (await prisma.user.create({ data: { email: `c-${Date.now()}@test.local`, passwordHash: "x" } })).id;
    const row = { id: "late-1", timestamp: "2026-09-01T00:00:00Z", symbol: "BTC/USDT", position: "LONG", entryPrice: 100, emotion: "Neutral", notes: "", status: "OPEN" };
    await importLegacyData(user, parseLegacyData({ journal: [row] }));

    const first = await createAttachment(user, png);
    await importLegacyData(user, parseLegacyData({ journal: [{ ...row, screenshotAttachmentId: first.id }] }));
    const [entry] = await listJournal(user);
    expect(entry.screenshotUrl).toBe(`/api/attachments/${first.id}`);

    const redundant = await createAttachment(user, png);
    await importLegacyData(user, parseLegacyData({ journal: [{ ...row, screenshotAttachmentId: redundant.id }] }));
    expect(await getAttachment(user, redundant.id)).toBeNull();
    expect((await listJournal(user))[0].screenshotUrl).toBe(`/api/attachments/${first.id}`);
  });
});
