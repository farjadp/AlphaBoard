import "server-only";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/http/errors";
import type { Bars } from "../bars";
import { decodeSeries, encodeSeries } from "./encode";

/** Strategy Lab datasets — the only Prisma access for stored bar series; every query is owner-scoped. */
export const MAX_DATASETS = 10;
const MAX_DATASET_BYTES = 40 * 1024 * 1024;

export type DatasetSource = "binance" | "oanda" | "mt5csv";
export type DatasetTimeframe = "1m" | "15m" | "1h";

export interface DatasetDto {
  id: string;
  symbol: string;
  source: DatasetSource;
  timeframe: DatasetTimeframe;
  fromAt: string;
  toAt: string;
  bars: number;
  hasSpread: boolean;
  sizeBytes: number;
  createdAt: string;
}

const select = { id: true, symbol: true, source: true, timeframe: true, fromAt: true, toAt: true, bars: true, hasSpread: true, sizeBytes: true, createdAt: true } as const;
interface Row { id: string; symbol: string; source: string; timeframe: string; fromAt: Date; toAt: Date; bars: number; hasSpread: boolean; sizeBytes: number; createdAt: Date }
const toDto = (r: Row): DatasetDto => ({
  id: r.id, symbol: r.symbol, source: r.source as DatasetSource, timeframe: r.timeframe as DatasetTimeframe,
  fromAt: r.fromAt.toISOString(), toAt: r.toAt.toISOString(), bars: r.bars, hasSpread: r.hasSpread, sizeBytes: r.sizeBytes,
  createdAt: r.createdAt.toISOString(),
});

export async function saveDataset(
  userId: string,
  meta: { symbol: string; source: DatasetSource; timeframe: DatasetTimeframe },
  bars: Bars,
  spread: Float64Array | null,
): Promise<DatasetDto> {
  const n = bars.t.length;
  if (!n) throw badRequest("the series has no bars");
  if ((await prisma.labDataset.count({ where: { userId } })) >= MAX_DATASETS)
    throw badRequest(`at most ${MAX_DATASETS} datasets — delete one first`, "LAB_DATASET_LIMIT");
  const blob = encodeSeries(bars, spread);
  if (blob.length > MAX_DATASET_BYTES) throw badRequest(`the series is ${Math.round(blob.length / 1e6)} MB compressed; the limit is ${MAX_DATASET_BYTES / 1e6} MB`, "LAB_DATASET_TOO_LARGE");
  const row = await prisma.labDataset.create({
    data: {
      userId, symbol: meta.symbol, source: meta.source, timeframe: meta.timeframe,
      fromAt: new Date(bars.t[0]), toAt: new Date(bars.t[n - 1]), bars: n, hasSpread: !!spread, sizeBytes: blob.length, blob,
    },
    select,
  });
  return toDto(row);
}

export async function listDatasets(userId: string): Promise<DatasetDto[]> {
  const rows = await prisma.labDataset.findMany({ where: { userId }, select, orderBy: { createdAt: "desc" } });
  return rows.map(toDto);
}

export async function loadDataset(userId: string, id: string): Promise<{ meta: DatasetDto; bars: Bars; spread: Float64Array | null }> {
  const r = await prisma.labDataset.findFirst({ where: { id, userId } });
  if (!r) throw notFound("dataset not found");
  const { bars, spread } = decodeSeries(Buffer.from(r.blob));
  return { meta: toDto(r), bars, spread };
}

export async function deleteDataset(userId: string, id: string): Promise<void> {
  const r = await prisma.labDataset.deleteMany({ where: { id, userId } });
  if (r.count !== 1) throw notFound("dataset not found");
}
