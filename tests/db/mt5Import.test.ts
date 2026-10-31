/** MT5 deal import against Postgres: positions → Mt5Trade + journal rows, idempotent, owner-only. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db/client";
import { importDeals, listMt5Trades } from "@/lib/lab/data/mt5Import";

const run = !!process.env.TEST_DATABASE_URL;
const H = "deal,order,position,time_utc,type,entry,symbol,volume,price,sl,tp,commission,swap,profit,fee,magic,comment,login=22215882,currency=USD";
const file = [H,
  "1,1,10,1760000000,0,0,XAUUSD.ec,0.02,4100,4087,0,-0.14,0,0,0,0,manual",
  "2,2,10,1760003600,1,1,XAUUSD.ec,0.02,4110,0,0,-0.14,-0.05,20,0,0,",
  "3,3,11,1760010000,1,0,XAUUSD.ec,0.01,4120,0,0,0,0,0,0,880801,GHE P2",
  "4,4,11,1760011000,0,1,XAUUSD.ec,0.01,4125,0,0,0,0,-5,0,880801,",
  "5,5,12,1760020000,0,0,XAUUSD.ec,0.01,4130,4120,0,0,0,0,0,0,still open",
].join("\n");

describe.skipIf(!run)("MT5 import (Postgres)", () => {
  let A: string, B: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "mt5-a@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "mt5-b@test.local", passwordHash: "x" } })).id;
  });
  beforeEach(async () => { await prisma.mt5Trade.deleteMany({}); await prisma.journalEntry.deleteMany({}); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("imports closed positions with a journal row each, and skips open ones", async () => {
    const r = await importDeals(A, file);
    expect(r).toMatchObject({ login: "22215882", imported: 2, alreadyThere: 0, stillOpen: 1 });
    const t = await prisma.mt5Trade.findFirstOrThrow({ where: { userId: A, positionId: "10" } });
    expect(t).toMatchObject({ symbol: "XAUUSD.ec", side: "LONG", stop: 4087, manual: true, currency: "USD" });
    expect(t.net).toBeCloseTo(19.67, 9);
    const j = await prisma.journalEntry.findFirstOrThrow({ where: { userId: A, legacyId: "mt5:22215882:10" } });
    expect(j).toMatchObject({ symbol: "XAUUSD.ec", position: "LONG", status: "CLOSED", pnlSource: "MT5", entryPrice: 4100, exitPrice: 4110 });
    expect(j.notes).toMatch(/\+19\.67 USD/);
  });

  it("a second import adds nothing; another user sees nothing", async () => {
    await importDeals(A, file);
    const again = await importDeals(A, file);
    expect(again).toMatchObject({ imported: 0, alreadyThere: 2 });
    expect(await prisma.journalEntry.count({ where: { userId: A } })).toBe(2);
    expect(await listMt5Trades(B)).toHaveLength(0);
    const mine = await listMt5Trades(A);
    expect(mine.map((x) => x.positionId)).toEqual(["10", "11"]);
    expect(mine[1]).toMatchObject({ manual: false, magic: 880801 });
  });
});
