import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findAsset } from "@/lib/assetCatalog";
import { badRequest, notFound } from "@/lib/http/errors";
import { logger } from "@/lib/http/logger";
import { oandaInstrument } from "@/lib/venues/oanda";
import { fetchBinanceHistory } from "./data/binance";
import { fetchOandaHistory } from "./data/oanda";
import { loadDataset, saveDataset } from "./data/store";
import { LadderStudySchema, runLadderStudy } from "./study";

/**
 * Strategy Lab jobs (P11b): a data download (FETCH) or a study (STUDY), queued per user and run one at a
 * time by the worker's "lab" loop. Every read is owner-scoped.
 */
export const MAX_ACTIVE_JOBS = 3;
const STALE_RUNNING_MS = 20 * 60_000;

export const FetchSpecSchema = z.object({
  kind: z.literal("fetch"),
  source: z.enum(["binance", "oanda"]),
  symbol: z.string().trim().min(1).max(30),
  timeframe: z.enum(["1m", "15m", "1h"]).default("1m"),
  days: z.number().int().min(7).max(730),
  /** OANDA connection of the user (read-only use of its token). */
  connectionId: z.string().min(1).max(40).optional(),
}).strict();
export const JobSpecSchema = z.discriminatedUnion("kind", [FetchSpecSchema, LadderStudySchema]);
export type JobSpec = z.output<typeof JobSpecSchema>;

export interface LabJobDto {
  id: string;
  kind: "FETCH" | "STUDY";
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  spec: JobSpec;
  result: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type Row = Prisma.LabJobGetPayload<object>;
const toDto = (r: Row): LabJobDto => ({
  id: r.id, kind: r.kind as LabJobDto["kind"], status: r.status as LabJobDto["status"], spec: r.spec as unknown as JobSpec,
  result: r.result ?? null, error: r.error, createdAt: r.createdAt.toISOString(),
  startedAt: r.startedAt?.toISOString() ?? null, finishedAt: r.finishedAt?.toISOString() ?? null,
});

export async function enqueueLabJob(userId: string, input: unknown): Promise<LabJobDto> {
  const parsed = JobSpecSchema.safeParse(input);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".") || "spec"}: ${i.message}`).join("; "), "LAB_BAD_SPEC");
  const spec = parsed.data;
  if (spec.kind === "fetch") {
    const asset = findAsset(spec.symbol);
    if (!asset) throw badRequest(`${spec.symbol} is not a supported symbol`, "LAB_BAD_SPEC");
    if (spec.source === "binance" && !asset.binanceSymbol) throw badRequest(`${spec.symbol} is not on Binance — use OANDA or an MT5 file`, "LAB_BAD_SPEC");
    if (spec.source === "oanda") {
      if (asset.category !== "forex" && asset.category !== "commodities") throw badRequest(`${spec.symbol} is not an OANDA instrument`, "LAB_BAD_SPEC");
      const conn = await prisma.exchangeConnection.findFirst({ where: { id: spec.connectionId ?? "", userId, provider: "oanda" } });
      if (!conn) throw badRequest("pick one of your OANDA connections", "LAB_BAD_SPEC");
    }
  } else if (!(await prisma.labDataset.findFirst({ where: { id: spec.datasetId, userId }, select: { id: true } }))) {
    throw notFound("dataset not found");
  }
  const active = await prisma.labJob.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } });
  if (active >= MAX_ACTIVE_JOBS) throw badRequest(`at most ${MAX_ACTIVE_JOBS} lab jobs at a time — wait for one to finish`, "LAB_BUSY");
  const row = await prisma.labJob.create({ data: { userId, kind: spec.kind === "fetch" ? "FETCH" : "STUDY", spec: spec as unknown as Prisma.InputJsonValue } });
  return toDto(row);
}

export async function listLabJobs(userId: string, take = 20): Promise<LabJobDto[]> {
  return (await prisma.labJob.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take })).map(toDto);
}

export async function getLabJob(userId: string, id: string): Promise<LabJobDto> {
  const r = await prisma.labJob.findFirst({ where: { id, userId } });
  if (!r) throw notFound("lab job not found");
  return toDto(r);
}

export interface LabJobDeps {
  fetchBinance?: typeof fetchBinanceHistory;
  fetchOanda?: typeof fetchOandaHistory;
  now?: () => number;
}

/** Claim and run the oldest queued job. Returns its id, or null when the queue is empty. */
export async function processNextLabJob(deps: LabJobDeps = {}): Promise<string | null> {
  const now = deps.now ?? Date.now;
  // A job left RUNNING by a crashed worker is failed, not retried forever.
  await prisma.labJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(now() - STALE_RUNNING_MS) } },
    data: { status: "FAILED", error: "the worker stopped while this job was running — start it again", finishedAt: new Date(now()) },
  });
  const next = await prisma.labJob.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
  if (!next) return null;
  const claimed = await prisma.labJob.updateMany({ where: { id: next.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(now()) } });
  if (claimed.count !== 1) return null;
  try {
    const spec = JobSpecSchema.parse(next.spec);
    const result = spec.kind === "fetch" ? await runFetch(next.userId, spec, deps, now()) : await runStudy(next.userId, spec);
    await prisma.labJob.update({ where: { id: next.id }, data: { status: "DONE", result: result as Prisma.InputJsonValue, finishedAt: new Date(now()) } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ jobId: next.id, err: msg }, "lab job failed");
    await prisma.labJob.update({ where: { id: next.id }, data: { status: "FAILED", error: msg.slice(0, 500), finishedAt: new Date(now()) } });
  }
  return next.id;
}

async function runFetch(userId: string, spec: z.output<typeof FetchSpecSchema>, deps: LabJobDeps, now: number) {
  const from = now - spec.days * 86_400_000;
  if (spec.source === "binance") {
    const asset = findAsset(spec.symbol)!;
    const r = await (deps.fetchBinance ?? fetchBinanceHistory)({ symbol: asset.binanceSymbol!, interval: spec.timeframe, from, to: now });
    const ds = await saveDataset(userId, { symbol: spec.symbol, source: "binance", timeframe: spec.timeframe }, r.bars, null);
    return { datasetId: ds.id, bars: ds.bars };
  }
  const conn = await prisma.exchangeConnection.findFirst({ where: { id: spec.connectionId ?? "", userId, provider: "oanda" } });
  if (!conn) throw new Error("the OANDA connection is gone");
  const granularity = spec.timeframe === "1m" ? "M1" : spec.timeframe === "15m" ? "M15" : "H1";
  const r = await (deps.fetchOanda ?? fetchOandaHistory)({ conn, instrument: oandaInstrument(spec.symbol), granularity, from, to: now });
  const ds = await saveDataset(userId, { symbol: spec.symbol, source: "oanda", timeframe: spec.timeframe }, r.bars, r.spread);
  return { datasetId: ds.id, bars: ds.bars };
}

async function runStudy(userId: string, spec: z.output<typeof LadderStudySchema>) {
  const ds = await loadDataset(userId, spec.datasetId);
  if (ds.meta.timeframe !== "1m") throw new Error("the ladder study needs 1-minute bars (stops and targets inside a 15-minute candle)");
  return { dataset: ds.meta, ...runLadderStudy(ds.bars, ds.spread, spec) };
}
