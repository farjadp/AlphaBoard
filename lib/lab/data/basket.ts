import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/http/errors";
import type { Cube } from "../dca";
import type { SymbolSeries } from "./binanceVision";
import { LabDataError } from "./encode";

/** Coin baskets for DCA studies — owner-scoped; one row per symbol so no single row gets huge. */
export const MAX_BASKETS = 3;
export const MAX_BASKET_SYMBOLS = 200;
const HOUR = 3_600_000;

export interface BasketDto { id: string; name: string; listedBy: string; fromAt: string; toAt: string; symbols: number; sizeBytes: number; createdAt: string }

function encode(s: SymbolSeries): Buffer {
  const n = s.c.length;
  const raw = Buffer.alloc(n * 16);
  [s.o, s.h, s.l, s.c].forEach((col, k) => { for (let i = 0; i < n; i++) raw.writeFloatLE(col[i], (k * n + i) * 4); });
  return gzipSync(raw, { level: 6 });
}

function decode(buf: Buffer, n: number): [Float32Array, Float32Array, Float32Array, Float32Array] {
  const raw = gunzipSync(buf);
  if (raw.length !== n * 16) throw new LabDataError("stored basket series is truncated");
  const col = (k: number) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = raw.readFloatLE((k * n + i) * 4); return a; };
  return [col(0), col(1), col(2), col(3)];
}

export async function saveBasket(userId: string, meta: { name: string; listedBy: string }, series: SymbolSeries[]): Promise<BasketDto> {
  if (!series.length) throw badRequest("the basket has no symbols with data");
  if (series.length > MAX_BASKET_SYMBOLS) throw badRequest(`at most ${MAX_BASKET_SYMBOLS} symbols per basket`);
  if ((await prisma.labBasket.count({ where: { userId } })) >= MAX_BASKETS) throw badRequest(`at most ${MAX_BASKETS} baskets — delete one first`, "LAB_BASKET_LIMIT");
  const blobs = series.map(encode);
  const from = Math.min(...series.map((s) => s.startHour));
  const to = Math.max(...series.map((s) => s.startHour + s.c.length - 1));
  const b = await prisma.labBasket.create({
    data: {
      userId, name: meta.name, listedBy: meta.listedBy, fromAt: new Date(from * HOUR), toAt: new Date(to * HOUR), symbols: series.length,
      sizeBytes: blobs.reduce((a, x) => a + x.length, 0),
    },
  });
  for (let k = 0; k < series.length; k += 20) {
    await prisma.labBasketSymbol.createMany({
      data: series.slice(k, k + 20).map((s, j) => ({ basketId: b.id, symbol: s.symbol, startHour: s.startHour, length: s.c.length, blob: blobs[k + j] })),
    });
  }
  return toDto(b);
}

const toDto = (b: { id: string; name: string; listedBy: string; fromAt: Date; toAt: Date; symbols: number; sizeBytes: number; createdAt: Date }): BasketDto => ({
  id: b.id, name: b.name, listedBy: b.listedBy, fromAt: b.fromAt.toISOString(), toAt: b.toAt.toISOString(), symbols: b.symbols, sizeBytes: b.sizeBytes, createdAt: b.createdAt.toISOString(),
});

export async function listBaskets(userId: string): Promise<BasketDto[]> {
  return (await prisma.labBasket.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })).map(toDto);
}

export async function deleteBasket(userId: string, id: string): Promise<void> {
  const r = await prisma.labBasket.deleteMany({ where: { id, userId } });
  if (r.count !== 1) throw notFound("basket not found");
}

/** The whole basket as one hourly cube (Float32, NaN where a symbol has no bar). */
export async function loadBasketCube(userId: string, id: string): Promise<{ meta: BasketDto; cube: Cube }> {
  const b = await prisma.labBasket.findFirst({ where: { id, userId } });
  if (!b) throw notFound("basket not found");
  const rows = await prisma.labBasketSymbol.findMany({ where: { basketId: id }, orderBy: { symbol: "asc" } });
  const h0 = Math.min(...rows.map((r) => r.startHour));
  const n = Math.max(...rows.map((r) => r.startHour + r.length)) - h0;
  const t = Float64Array.from({ length: n }, (_, k) => (h0 + k) * HOUR);
  const cube: Cube = { t, syms: [], o: [], h: [], l: [], c: [] };
  for (const r of rows) {
    const cols = decode(Buffer.from(r.blob), r.length);
    const full = cols.map((c) => { const a = new Float32Array(n).fill(Number.NaN); a.set(c, r.startHour - h0); return a; });
    cube.syms.push(r.symbol); cube.o.push(full[0]); cube.h.push(full[1]); cube.l.push(full[2]); cube.c.push(full[3]);
  }
  return { meta: toDto(b), cube };
}
