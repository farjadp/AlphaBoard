/** Worker lease: one holder at a time, renewable by the holder, taken over after expiry. */
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { acquireLease, releaseLease, LEASE_KEY } from "@/lib/worker";

const run = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!run)("worker lease (Postgres)", () => {
  afterAll(async () => {
    await prisma.appSetting.deleteMany({ where: { key: LEASE_KEY } });
    await prisma.$disconnect();
  });

  it("grants, renews, blocks others, hands over on expiry and on release", async () => {
    await prisma.appSetting.deleteMany({ where: { key: LEASE_KEY } });
    const t = Date.now();
    expect(await acquireLease("a", t)).toBe(true);
    expect(await acquireLease("a", t + 10_000)).toBe(true);
    expect(await acquireLease("b", t + 20_000)).toBe(false);
    expect(await acquireLease("b", t + 10_000 + 46_000)).toBe(true);
    expect(await acquireLease("a", t + 60_000)).toBe(false);
    await releaseLease("b");
    expect(await acquireLease("a", t + 60_000)).toBe(true);
  });
});
