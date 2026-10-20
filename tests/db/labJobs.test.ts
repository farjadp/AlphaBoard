/** Strategy Lab jobs against Postgres: enqueue rules, the worker pass, owner-only reads. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { makeBars } from "@/lib/lab/bars";
import { saveDataset } from "@/lib/lab/data/store";
import { enqueueLabJob, getLabJob, listLabJobs, processNextLabJob, MAX_ACTIVE_JOBS } from "@/lib/lab/jobs";

const run = !!process.env.TEST_DATABASE_URL;
const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 5);
function zigzag() {
  const rows: Array<[number, number, number, number, number]> = [];
  for (let d = 0; d < 12; d++) {
    const day = new Date(T0 + d * 86_400_000).getUTCDay();
    if (day === 0 || day === 6) continue;
    for (let m = 0; m < 1440; m++) {
      const ph = (m % 40) / 40;
      const px = 100 + 1.4 * (ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4);
      rows.push([T0 + d * 86_400_000 + m * MIN, px, px + 0.05, px - 0.05, px]);
    }
  }
  return makeBars(rows);
}
const fakeBinance = async () => ({ bars: zigzag(), from: T0, to: T0 + 1 });

describe.skipIf(!run)("lab jobs (Postgres)", () => {
  let A: string, B: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "labj-a@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "labj-b@test.local", passwordHash: "x" } })).id;
  });
  beforeEach(async () => { await prisma.labJob.deleteMany({}); await prisma.labDataset.deleteMany({}); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("a fetch job downloads, stores the dataset and records its id", async () => {
    const job = await enqueueLabJob(A, { kind: "fetch", source: "binance", symbol: "BTC/USDT", timeframe: "1m", days: 30 });
    expect(job.status).toBe("QUEUED");
    const done = await processNextLabJob({ fetchBinance: fakeBinance });
    expect(done).toBe(job.id);
    const after = await getLabJob(A, job.id);
    expect(after.status).toBe("DONE");
    const ds = await prisma.labDataset.findFirstOrThrow({ where: { userId: A } });
    expect(after.result).toMatchObject({ datasetId: ds.id });
    expect(ds).toMatchObject({ symbol: "BTC/USDT", source: "binance", timeframe: "1m" });
  });

  it("a study job runs on the owner's dataset and stores the verdict", async () => {
    const ds = await saveDataset(A, { symbol: "X", source: "mt5csv", timeframe: "1m" }, zigzag(), null);
    const job = await enqueueLabJob(A, { kind: "ladder", datasetId: ds.id, direction: "both", robustness: 3 });
    await processNextLabJob({});
    const after = await getLabJob(A, job.id);
    expect(after.status).toBe("DONE");
    expect((after.result as { verdict: string[] }).verdict.length).toBeGreaterThan(2);
  });

  it("refuses a study on someone else's dataset, an unknown symbol, and too many active jobs", async () => {
    const ds = await saveDataset(A, { symbol: "X", source: "mt5csv", timeframe: "1m" }, zigzag(), null);
    await expect(enqueueLabJob(B, { kind: "ladder", datasetId: ds.id })).rejects.toMatchObject({ status: 404 });
    await expect(enqueueLabJob(A, { kind: "fetch", source: "binance", symbol: "NOPE/USDT", timeframe: "1m", days: 30 })).rejects.toMatchObject({ status: 400 });
    for (let i = 0; i < MAX_ACTIVE_JOBS; i++) await enqueueLabJob(A, { kind: "ladder", datasetId: ds.id });
    await expect(enqueueLabJob(A, { kind: "ladder", datasetId: ds.id })).rejects.toMatchObject({ status: 400 });
  });

  it("a failing job is marked FAILED with a readable error; another user cannot read it", async () => {
    const job = await enqueueLabJob(A, { kind: "fetch", source: "binance", symbol: "BTC/USDT", timeframe: "1m", days: 30 });
    await processNextLabJob({ fetchBinance: async () => { throw new Error("Binance has no bars for BTCUSDT"); } });
    const after = await getLabJob(A, job.id);
    expect(after).toMatchObject({ status: "FAILED", error: "Binance has no bars for BTCUSDT" });
    await expect(getLabJob(B, job.id)).rejects.toMatchObject({ status: 404 });
    expect(await listLabJobs(B)).toHaveLength(0);
  });

  it("does nothing when the queue is empty", async () => {
    expect(await processNextLabJob({})).toBeNull();
  });
});
