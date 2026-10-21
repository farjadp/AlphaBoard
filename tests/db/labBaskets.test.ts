/** Coin baskets against Postgres: round trip into a cube, owner-only, caps. */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { deleteBasket, listBaskets, loadBasketCube, saveBasket, MAX_BASKETS } from "@/lib/lab/data/basket";
import type { SymbolSeries } from "@/lib/lab/data/binanceVision";

const run = !!process.env.TEST_DATABASE_URL;
const H0 = Date.UTC(2021, 0, 1) / 3_600_000;
const series = (symbol: string, start: number, len: number, px: number): SymbolSeries => {
  const c = Float32Array.from({ length: len }, (_, k) => px + k);
  return { symbol, startHour: start, o: c, h: c, l: c, c };
};

describe.skipIf(!run)("lab baskets (Postgres)", () => {
  let A: string, B: string;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    A = (await prisma.user.create({ data: { email: "bk-a@test.local", passwordHash: "x" } })).id;
    B = (await prisma.user.create({ data: { email: "bk-b@test.local", passwordHash: "x" } })).id;
  });
  beforeEach(async () => { await prisma.labBasket.deleteMany({}); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("stores symbols with their own ranges and loads them into one aligned cube", async () => {
    const b = await saveBasket(A, { name: "test", listedBy: "2021-01" }, [series("BTCUSDT", H0, 48, 100), series("LUNAUSDT", H0 + 24, 10, 5)]);
    expect(b).toMatchObject({ symbols: 2, listedBy: "2021-01" });
    const { cube } = await loadBasketCube(A, b.id);
    expect(cube.syms).toEqual(["BTCUSDT", "LUNAUSDT"]);
    expect(cube.t.length).toBe(48);
    expect(cube.c[0][47]).toBe(147);
    expect(Number.isNaN(cube.c[1][0])).toBe(true);
    expect(cube.c[1][24]).toBe(5);
    expect(Number.isNaN(cube.c[1][40])).toBe(true); // delisted after 10 hours
  });

  it("owner-only and capped", async () => {
    const b = await saveBasket(A, { name: "x", listedBy: "2021-01" }, [series("BTCUSDT", H0, 5, 1)]);
    await expect(loadBasketCube(B, b.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteBasket(B, b.id)).rejects.toMatchObject({ status: 404 });
    expect(await listBaskets(B)).toHaveLength(0);
    for (let i = 1; i < MAX_BASKETS; i++) await saveBasket(A, { name: "x", listedBy: "2021-01" }, [series("BTCUSDT", H0, 5, 1)]);
    await expect(saveBasket(A, { name: "x", listedBy: "2021-01" }, [series("BTCUSDT", H0, 5, 1)])).rejects.toMatchObject({ status: 400 });
  });
});
