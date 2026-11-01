/** Strategy Lab datasets against Postgres: owner-only, caps, round trip. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { makeBars } from "@/lib/lab/bars";
import { deleteDataset, listDatasets, loadDataset, saveDataset, MAX_DATASETS } from "@/lib/lab/data/store";

const run = !!process.env.TEST_DATABASE_URL;
const bars = makeBars(Array.from({ length: 100 }, (_, i) => [Date.UTC(2026, 0, 5) + i * 60_000, 1, 2, 0.5, 1.5] as const));
const meta = { symbol: "XAU/USD", source: "oanda" as const, timeframe: "1m" as const };

describe.skipIf(!run)("lab datasets (Postgres)", () => {
  let A: string, B: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "lab-a@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "lab-b@test.local", passwordHash: "x" } })).id;
  });
  beforeEach(async () => { await prisma.labDataset.deleteMany({}); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("saves and loads a series with its spread; the list carries no blob", async () => {
    const spread = new Float64Array(100).fill(0.2);
    const d = await saveDataset(A, meta, bars, spread);
    expect(d).toMatchObject({ symbol: "XAU/USD", bars: 100, hasSpread: true, timeframe: "1m" });
    expect(d.fromAt).toBe(new Date(bars.t[0]).toISOString());
    const back = await loadDataset(A, d.id);
    expect(Array.from(back.bars.c.slice(0, 3))).toEqual([1.5, 1.5, 1.5]);
    expect(back.spread![99]).toBe(0.2);
    expect(back.meta).not.toHaveProperty("blob");
    const list = await listDatasets(A);
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("blob");
  });

  it("another user can neither load nor delete it", async () => {
    const d = await saveDataset(A, meta, bars, null);
    await expect(loadDataset(B, d.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteDataset(B, d.id)).rejects.toMatchObject({ status: 404 });
    expect(await listDatasets(B)).toHaveLength(0);
    await deleteDataset(A, d.id);
    expect(await listDatasets(A)).toHaveLength(0);
  });

  it("refuses more than the per-user maximum", async () => {
    for (let i = 0; i < MAX_DATASETS; i++) await saveDataset(A, meta, bars, null);
    await expect(saveDataset(A, meta, bars, null)).rejects.toMatchObject({ status: 400 });
  });
});
