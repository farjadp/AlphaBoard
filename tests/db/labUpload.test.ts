/** The Lab upload route against Postgres (admin mocked). Opt-in big-file case with LAB_GOLDEN_DIR. */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db/client";

const run = !!process.env.TEST_DATABASE_URL;
const admin = { id: "", email: "lab-up@test.local", role: "ADMIN" };
vi.mock("@/lib/auth/dal", () => ({ requireAdmin: async () => admin }));

const csv = (rows: string[]) => ["utc,open,high,low,close,spread_points,point,symbol=XAUUSD.ec", ...rows].join("\n");
const post = async (body: string, extra: Record<string, string> = {}) => {
  const { POST } = await import("@/app/api/admin/lab/datasets/route");
  const fd = new FormData();
  fd.set("file", new File([body], "M1_XAUUSD.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return POST(new Request("http://localhost/api/admin/lab/datasets", { method: "POST", body: fd }), { params: Promise.resolve({}) });
};

describe.skipIf(!run)("lab upload route (Postgres)", () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "User" CASCADE`);
    admin.id = (await prisma.user.create({ data: { email: admin.email, passwordHash: "x", role: "ADMIN" } })).id;
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("stores a valid export and names it", async () => {
    const body = csv(["1760374620,4108.92,4108.92,4107.09,4107.51,18,0.01", "1760374680,4107.5,4108,4107,4107.8,20,0.01"]);
    const res = await post(body, { size: String(Buffer.byteLength(body)), symbol: "XAUUSD ePlanet" });
    expect(res.status).toBe(201);
    expect((await res.json()).dataset).toMatchObject({ symbol: "XAUUSD ePlanet", bars: 2, hasSpread: true, source: "mt5csv" });
  });

  it("refuses a body that arrived incomplete and a file in another format", async () => {
    const body = csv(["1760374620,1,1,1,1,1,0.01"]);
    expect((await post(body, { size: String(Buffer.byteLength(body) + 10) })).status).toBe(400);
    const bad = await post("date,price\n1,2");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/ExportM1/);
  });

  const big = join(process.env.LAB_GOLDEN_DIR ?? "", "M1_XAUUSD.csv");
  it.skipIf(!process.env.LAB_GOLDEN_DIR || !existsSync(big))("takes a real year of broker M1 bars (~26 MB)", async () => {
    const body = readFileSync(big, "utf8");
    const res = await post(body, { size: String(Buffer.byteLength(body)) });
    expect(res.status).toBe(201);
    const ds = (await res.json()).dataset;
    expect(ds.bars).toBe(359_890);
    expect(ds.sizeBytes).toBeLessThan(40 * 1024 * 1024);
  }, 120_000);
});
