import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { pruneEvents, recentEvents, recordEvent } from "@/lib/ops/events";
import { systemOverview } from "@/lib/ops/overview";
import { runTick } from "@/lib/jobs/tick";

const run = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!run)("system events & overview (Postgres)", () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "SystemEvent", "User" CASCADE`);
    await prisma.appSetting.deleteMany({ where: { key: { in: ["tick.last", "tick.history"] } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("folds repeats of the same failure within 10 minutes into one row, and starts a new row after", async () => {
    const t = new Date("2026-09-28T12:00:00Z");
    await recordEvent({ source: "http", message: "POST /api/paper/positions/cmaaa11111/close: boom 1", requestId: "r1" }, t);
    await recordEvent({ source: "http", message: "POST /api/paper/positions/cmbbb22222/close: boom 2", requestId: "r2" }, new Date(t.getTime() + 60_000));
    await recordEvent({ source: "http", message: "POST /api/paper/positions/cmccc33333/close: boom 3" }, new Date(t.getTime() + 20 * 60_000));
    const rows = await recentEvents();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ count: 2, requestId: "r2" });
    await pruneEvents(new Date(t.getTime() + 15 * 86_400_000));
    expect(await recentEvents()).toHaveLength(0);
  });

  it("the tick keeps a bounded run history and records its errors as an event", async () => {
    await runTick({ telegram: null, signalBarsOf: async () => null, barsOf: async () => null, priceOf: async () => null });
    const hist = await prisma.appSetting.findUniqueOrThrow({ where: { key: "tick.history" } });
    expect(Array.isArray(hist.value) && hist.value.length).toBe(1);
    const o = await systemOverview();
    if (!o.db) throw new Error("db down");
    expect(o.tick.state).toBe("ok");
    expect(o.tick.history).toHaveLength(1);
    expect(o.status).toBe("ok");
    expect(o.people.users).toBe(0);
  });
});
