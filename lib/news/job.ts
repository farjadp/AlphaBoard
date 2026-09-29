import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runIngest, targetAssets, type IngestResult } from "./ingest";
import { evaluatePending, snapshotIndex, type BarsOf } from "./measure";
import { runWeightAgent } from "./weights";
import type { ProviderSpec } from "./sources";

export const NEWS_LAST_KEY = "news.last";
const DAY = 86_400_000;

export interface NewsJobResult {
  at: string;
  ms: number;
  calls: IngestResult["calls"];
  stored: number;
  merged: number;
  snapshots: number;
  evaluated: { links: number; snapshots: number };
  weightRun: string | null;
  pruned: number;
  errors: string[];
}

/**
 * One pass of the news hub, run by the worker every 2 minutes. Each provider has its own interval and
 * daily budget, snapshots are once per hour, the weights agent once per week — so most passes do little.
 * Every part is isolated: one failing never skips the rest.
 */
export async function runNewsJob(deps: { now?: Date; providers?: ProviderSpec[]; barsOf?: BarsOf } = {}): Promise<NewsJobResult> {
  const now = deps.now ?? new Date();
  const started = Date.now();
  const errors: string[] = [];
  const part = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch (e) { errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); return fallback; }
  };

  const targets = await part("targets", () => targetAssets(), []);
  const ingest = await part("ingest", () => runIngest({ now, targets, providers: deps.providers }), { calls: [], stored: 0, merged: 0 });
  const snapshots = await part("snapshots", () => snapshotIndex(targets, now), 0);
  const evaluated = await part("evaluate", () => evaluatePending(now, deps.barsOf), { links: 0, snapshots: 0 });
  const weightRun = await part("weights", () => runWeightAgent({ now }), null);
  const pruned = await part("prune", async () => {
    const [a, s] = await Promise.all([
      prisma.newsArticle.deleteMany({ where: { publishedAt: { lt: new Date(now.getTime() - 90 * DAY) } } }),
      prisma.newsIndexSnapshot.deleteMany({ where: { at: { lt: new Date(now.getTime() - 180 * DAY) } } }),
    ]);
    return a.count + s.count;
  }, 0);

  const result: NewsJobResult = { at: now.toISOString(), ms: Date.now() - started, calls: ingest.calls, stored: ingest.stored, merged: ingest.merged, snapshots, evaluated, weightRun, pruned, errors };
  const value = result as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: NEWS_LAST_KEY }, create: { key: NEWS_LAST_KEY, value }, update: { value } }).catch(() => undefined);
  return result;
}
