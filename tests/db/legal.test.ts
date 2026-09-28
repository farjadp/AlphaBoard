import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { acceptDisclaimer, hasAcceptedDisclaimer } from "@/lib/legal/accept";

const run = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!run)("risk disclaimer acceptance (Postgres)", () => {
  let id: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    id = (await prisma.user.create({ data: { email: "legal@test.local", passwordHash: "x" } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("records the first acceptance once, keeps its time, and audits it once", async () => {
    expect(await hasAcceptedDisclaimer(id)).toBe(false);
    const first = await acceptDisclaimer(id, "1.2.3.4");
    const again = await acceptDisclaimer(id);
    expect(again.getTime()).toBe(first.getTime());
    expect(await hasAcceptedDisclaimer(id)).toBe(true);
    expect(await prisma.auditLog.count({ where: { userId: id, action: "legal.disclaimer_accepted" } })).toBe(1);
  });
});
