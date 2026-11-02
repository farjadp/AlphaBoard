/** P18a against Postgres: analyst plan drafts, review, activation rules, owner isolation and the scorecard. */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { activatePlan, addZone, archivePlan, createPlan, deletePlan, listPlans, scorecard, updatePlan, updateZone } from "@/lib/analyst/store";
import type { ZoneDraft } from "@/lib/analyst/extract";

const run = !!process.env.TEST_DATABASE_URL;

const zone = (over: Partial<ZoneDraft> = {}): ZoneDraft => ({
  symbol: "XAU/USD", kind: "SELL", low: 3940, high: 3976, direction: null, closeTf: null, condition: null, explain: null, note: null, uncertain: false, ...over,
});
const NOW = new Date("2026-11-01T23:00:00Z");
const plan = (over: Record<string, unknown> = {}) => ({
  source: "Nima Razzaghi", title: "Week 45", rawText: "…", events: [], offsets: { "XAU/USD": 20 }, expiresAt: "2026-11-07T00:00:00Z",
  zones: [zone(), zone({ kind: "BUY", low: 3850, high: 3865, uncertain: true })], ...over,
});

describe.skipIf(!run)("analyst plans store (Postgres)", () => {
  let A: string, B: string;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "aa@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "ab@test.local", passwordHash: "x" } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("creates a draft and keeps it private to its owner", async () => {
    const p = await createPlan(A, plan());
    expect(p).toMatchObject({ status: "DRAFT", source: "Nima Razzaghi", offsets: { "XAU/USD": 20 } });
    expect(p.zones).toHaveLength(2);
    expect(await listPlans(B)).toEqual([]);
    await expect(updateZone(B, p.zones[0].id, { low: 1 })).rejects.toThrow(/not found/);
    await expect(activatePlan(B, p.id, NOW)).rejects.toThrow(/not found/);
  });

  it("refuses activation while an uncertain zone is unconfirmed, then activates", async () => {
    const p = await createPlan(A, plan());
    await expect(activatePlan(A, p.id, NOW)).rejects.toThrow(/confirm/i);
    const buy = p.zones.find((z) => z.kind === "BUY")!;
    await updateZone(A, buy.id, { confirmed: true, condition: "15m trigger" });
    const kept = await updateZone(A, buy.id, { low: 3852 });
    expect(kept).toMatchObject({ low: 3852, confirmed: true, condition: "15m trigger", uncertain: true });
    const active = await activatePlan(A, p.id, NOW);
    expect(active.status).toBe("ACTIVE");
    expect(active.zones.every((z) => z.state === "WAITING")).toBe(true);
    const z = await prisma.analystZone.findUniqueOrThrow({ where: { id: buy.id } });
    expect(z).toMatchObject({ low: 3852, confirmed: true });
    expect(z.lastCheckedAt.toISOString()).toBe(NOW.toISOString());
    // Active plans are frozen.
    await expect(updateZone(A, buy.id, { low: 3800 })).rejects.toThrow(/draft/i);
    await expect(updatePlan(A, p.id, { title: "x" })).rejects.toThrow(/draft/i);
    // The channel switch alone may change on an active plan.
    expect((await updatePlan(A, p.id, { postToChannel: true })).postToChannel).toBe(true);
    await expect(updatePlan(A, p.id, { postToChannel: false, title: "x" })).rejects.toThrow(/draft/i);
    await expect(deletePlan(A, p.id)).rejects.toThrow(/archive/i);
  });

  it("refuses a plan with nothing to watch or an expiry in the past", async () => {
    const info = await createPlan(A, plan({ zones: [zone({ kind: "INFO" })] }));
    await expect(activatePlan(A, info.id, NOW)).rejects.toThrow(/nothing to watch/i);
    const old = await createPlan(A, plan({ zones: [zone()], expiresAt: "2026-10-01T00:00:00Z" }));
    await expect(activatePlan(A, old.id, NOW)).rejects.toThrow(/expir/i);
  });

  it("adds and edits zones and plan fields on a draft, and validates them", async () => {
    const p = await createPlan(A, plan({ zones: [] }));
    const z = await addZone(A, p.id, zone());
    expect(z.symbol).toBe("XAU/USD");
    await expect(addZone(A, p.id, zone({ symbol: "NOPE" }))).rejects.toThrow(/symbol/i);
    await expect(updateZone(A, z.id, { low: 4000, high: 3990 })).rejects.toThrow(/low/i);
    const u = await updatePlan(A, p.id, { offsets: { "XAU/USD": 18.5 }, events: [{ at: "2026-11-06T13:30:00Z", label: "NFP" }] });
    expect(u).toMatchObject({ offsets: { "XAU/USD": 18.5 }, events: [{ at: "2026-11-06T13:30:00.000Z", label: "NFP" }] });
    expect(await updatePlan(A, p.id, { title: "renamed" })).toMatchObject({ title: "renamed", offsets: { "XAU/USD": 18.5 } });
    await deletePlan(A, p.id);
    expect((await listPlans(A)).some((x) => x.id === p.id)).toBe(false);
  });

  it("marks agreement between sources and scores per source", async () => {
    const mine = await createPlan(A, plan({ source: "Me", zones: [zone({ low: 3920, high: 3975 })] }));
    await activatePlan(A, mine.id, NOW);
    const list = await listPlans(A);
    const mineZone = list.find((p) => p.id === mine.id)!.zones[0];
    expect(mineZone.agrees).toEqual(["Nima Razzaghi"]);

    await prisma.analystZone.update({ where: { id: mineZone.id }, data: { state: "SCORED", outcome: "RESPECTED" } });
    const card = await scorecard(A);
    expect(card.find((c) => c.source === "Me")).toMatchObject({ zones: 1, respected: 1, broke: 0 });
  });

  it("archives and caps the number of open plans", async () => {
    const p = await createPlan(A, plan());
    await archivePlan(A, p.id);
    expect((await listPlans(A)).find((x) => x.id === p.id)?.status).toBe("ARCHIVED");
    await prisma.analystPlan.deleteMany({ where: { userId: B } });
    for (let i = 0; i < 20; i++) await createPlan(B, plan({ zones: [] }));
    await expect(createPlan(B, plan({ zones: [] }))).rejects.toThrow(/20/);
  });
});
