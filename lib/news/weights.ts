import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aiJson } from "@/lib/ai";
import { HttpError } from "@/lib/http/errors";
import { publisherReport, type PublisherRow } from "./measure";

/**
 * Weekly news-weights agent (spec: News Hub). The agent proposes a credibility weight per publisher from
 * measured accuracy; the code decides what is applied: range 0.1–1.0, at most ±0.2 per week, and only for
 * publishers with ≥ 20 evaluated calls. Every change is logged with the agent's reason and the numbers.
 */
export const WEIGHT_LIMITS = { min: 0.1, max: 1, weeklyStep: 0.2, minCalls: 20 } as const;
export const WEIGHTS_LAST_KEY = "news.weights.last";
const WEEK = 7 * 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function guardWeight(from: number, proposed: number): { to: number; clamped: boolean } {
  const lo = Math.max(WEIGHT_LIMITS.min, from - WEIGHT_LIMITS.weeklyStep);
  const hi = Math.min(WEIGHT_LIMITS.max, from + WEIGHT_LIMITS.weeklyStep);
  const to = round2(Math.min(hi, Math.max(lo, proposed)));
  return { to, clamped: to !== round2(proposed) };
}

export const WeightProposalSchema = z.object({
  summary: z.string().min(1).max(2_000),
  changes: z.array(z.object({ publisher: z.string().min(1).max(80), weight: z.number(), reason: z.string().min(1).max(800) })).max(100),
});
export const WEIGHT_PROPOSAL_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "changes"],
  properties: {
    summary: { type: "string" },
    changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["publisher", "weight", "reason"],
      properties: { publisher: { type: "string" }, weight: { type: "number" }, reason: { type: "string" } } } },
  },
} as const;

const SYSTEM = `You set credibility weights for news publishers in a trading dashboard. A publisher's weight (0.1–1.0) scales how
much its headlines count in the news ranking and news index. Base every change on the measured numbers you are given:
a "call" is a headline with non-neutral sentiment; hit rates say how often the price then moved the called way within
4 h / 24 h; avgSignedRet24hPct is the average move in the called direction (positive = useful). Compare each publisher
with the overall baseline, prefer the 30-day window over the last week, and treat small samples with caution. Leave a
publisher out of "changes" when the evidence does not justify moving it. The code limits every change to ±0.2 per week.
For each change, "publisher" is the key from the table and "reason" explains the decision in plain English, citing the
numbers. "summary" is 2–4 sentences on what changed and why.

Return one JSON object with exactly these keys (no markdown):
{"summary":"…","changes":[{"publisher":"coindesk","weight":0.6,"reason":"…"}]}`;

const pct = (n: number | null) => (n == null ? "n/a" : `${(n * 100).toFixed(1)}%`);
const table = (rows: PublisherRow[]) => rows.map((p) =>
  `${p.key} (${p.name}) · weight ${p.weight.toFixed(2)} · 30d: ${p.window.calls} calls of ${p.window.articles}, hit 4h ${pct(p.window.hitRate4h)}, hit 24h ${pct(p.window.hitRate24h)}, avgSignedRet24h ${p.window.avgSignedRet24hPct?.toFixed(2) ?? "n/a"}% · last 7d: ${p.lastWeek.calls} calls, hit 24h ${pct(p.lastWeek.hitRate24h)}`).join("\n");

const evidence = (p: PublisherRow) => ({ window30d: p.window, last7d: p.lastWeek }) as unknown as Prisma.InputJsonValue;

export interface WeightRunDeps { now?: Date; ai?: typeof aiJson; force?: boolean }

/** Runs at most once a week (unless forced). Returns the run id, or null when it was not due. */
export async function runWeightAgent(deps: WeightRunDeps = {}): Promise<string | null> {
  const now = deps.now ?? new Date();
  const last = await prisma.appSetting.findUnique({ where: { key: WEIGHTS_LAST_KEY } });
  const lastAt = typeof last?.value === "string" ? Date.parse(last.value) : NaN;
  if (!deps.force && Number.isFinite(lastAt) && now.getTime() - lastAt < WEEK) return null;
  const markRun = (at: Date) => prisma.appSetting.upsert({ where: { key: WEIGHTS_LAST_KEY }, create: { key: WEIGHTS_LAST_KEY, value: at.toISOString() }, update: { value: at.toISOString() } });

  const report = await publisherReport(now, 30);
  const eligible = report.publishers.filter((p) => p.window.calls >= WEIGHT_LIMITS.minCalls);
  if (!eligible.length) {
    const run = await prisma.newsWeightRun.create({ data: { at: now, status: "skipped", summary: `No publisher has ${WEIGHT_LIMITS.minCalls} evaluated calls in 30 days yet; weights unchanged. The agent was not called.` } });
    await markRun(now);
    return run.id;
  }
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!admin) {
    const run = await prisma.newsWeightRun.create({ data: { at: now, status: "error", error: "No admin user to bill the AI call to." } });
    await markRun(new Date(now.getTime() - WEEK + 86_400_000));
    return run.id;
  }

  try {
    const user = `Limits: weight ${WEIGHT_LIMITS.min}–${WEIGHT_LIMITS.max}, at most ±${WEIGHT_LIMITS.weeklyStep} per week.\n`
      + `Overall baseline (all publishers, 30d): ${report.overall.calls} calls, hit 4h ${pct(report.overall.hitRate4h)}, hit 24h ${pct(report.overall.hitRate24h)}, avgSignedRet24h ${report.overall.avgSignedRet24hPct?.toFixed(2) ?? "n/a"}%.\n\n`
      + `Publishers with ≥ ${WEIGHT_LIMITS.minCalls} evaluated calls:\n${table(eligible)}`;
    const { data, meta } = await (deps.ai ?? aiJson)({
      feature: "news.weights", userId: admin.id, system: SYSTEM, user, schema: WeightProposalSchema,
      jsonSchema: WEIGHT_PROPOSAL_JSON_SCHEMA as unknown as Record<string, unknown>, maxTokens: 2_500, temperature: 0.2, timeoutMs: 90_000,
    });
    const skipped: Array<{ publisher: string; proposed: number; why: string }> = [];
    const run = await prisma.newsWeightRun.create({ data: { at: now, status: "ok", summary: data.summary, model: `${meta.provider}/${meta.model}`, costUsd: meta.costUsd } });
    for (const c of data.changes) {
      const p = eligible.find((e) => e.key === c.publisher.trim().toLowerCase());
      if (!p) { skipped.push({ publisher: c.publisher, proposed: c.weight, why: `unknown publisher or fewer than ${WEIGHT_LIMITS.minCalls} evaluated calls` }); continue; }
      if (!Number.isFinite(c.weight)) { skipped.push({ publisher: p.key, proposed: c.weight, why: "not a number" }); continue; }
      const g = guardWeight(p.weight, c.weight);
      if (g.to === round2(p.weight)) continue;
      await prisma.$transaction([
        prisma.newsPublisher.update({ where: { key: p.key }, data: { weight: g.to } }),
        prisma.publisherWeightChange.create({ data: { publisherKey: p.key, runId: run.id, by: "agent", from: p.weight, proposed: c.weight, to: g.to, clamped: g.clamped, reason: c.reason, evidence: evidence(p) } }),
      ]);
    }
    if (skipped.length) await prisma.newsWeightRun.update({ where: { id: run.id }, data: { skipped: skipped as unknown as Prisma.InputJsonValue } });
    await markRun(now);
    return run.id;
  } catch (e) {
    const run = await prisma.newsWeightRun.create({ data: { at: now, status: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
    await markRun(new Date(now.getTime() - WEEK + 86_400_000)); // retry in a day, not every 10 minutes
    return run.id;
  }
}

/** Admin override: any value in range, no weekly step, logged with the admin's reason. */
export async function setPublisherWeight(key: string, weight: number, adminId: string, reason: string) {
  if (!(weight >= WEIGHT_LIMITS.min && weight <= WEIGHT_LIMITS.max)) throw new HttpError(400, `Weight must be between ${WEIGHT_LIMITS.min} and ${WEIGHT_LIMITS.max}`, "BAD_WEIGHT");
  const p = await prisma.newsPublisher.findUnique({ where: { key } });
  if (!p) throw new HttpError(404, "Publisher not found", "NOT_FOUND");
  const to = round2(weight);
  await prisma.$transaction([
    prisma.newsPublisher.update({ where: { key }, data: { weight: to } }),
    prisma.publisherWeightChange.create({ data: { publisherKey: key, by: "admin", userId: adminId, from: p.weight, proposed: weight, to, reason } }),
  ]);
}

/** Undo a change — only the latest one for its publisher, so the history stays readable. */
export async function revertWeightChange(changeId: string, adminId: string) {
  const c = await prisma.publisherWeightChange.findUnique({ where: { id: changeId } });
  if (!c) throw new HttpError(404, "Change not found", "NOT_FOUND");
  if (c.revertedAt) throw new HttpError(409, "Already reverted", "ALREADY_REVERTED");
  const latest = await prisma.publisherWeightChange.findFirst({ where: { publisherKey: c.publisherKey }, orderBy: { createdAt: "desc" } });
  if (latest?.id !== c.id) throw new HttpError(409, "Only the latest change of a publisher can be reverted", "NOT_LATEST");
  const p = await prisma.newsPublisher.findUniqueOrThrow({ where: { key: c.publisherKey } });
  await prisma.$transaction([
    prisma.newsPublisher.update({ where: { key: p.key }, data: { weight: c.from } }),
    prisma.publisherWeightChange.update({ where: { id: c.id }, data: { revertedAt: new Date() } }),
    prisma.publisherWeightChange.create({ data: { publisherKey: p.key, by: "admin", userId: adminId, from: p.weight, proposed: c.from, to: c.from, reason: `Reverted the ${c.by} change of ${c.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC (${c.from.toFixed(2)} → ${c.to.toFixed(2)})`, revertOfId: c.id } }),
  ]);
}
