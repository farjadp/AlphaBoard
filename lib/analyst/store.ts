import "server-only";
import type { AnalystPlan, AnalystZone, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { badRequest, notFound } from "@/lib/http/errors";
import { findAsset } from "@/lib/market/catalog";
import { MAX_ZONES } from "./extract";
import { agreements } from "./zones";

/**
 * Analyst plans (P18a): drafts the owner reviews, then ACTIVE plans the worker watches (lib/analyst/job.ts), then
 * ARCHIVED. Only drafts can be edited, so a plan's outcomes are always scored against what was activated.
 */
const MAX_OPEN_PLANS = 20;

const price = z.number().positive().finite();
const symbol = z.string().trim().refine((s) => !!findAsset(s), "unknown symbol");
const optText = (max: number) => z.string().trim().max(max).nullable().transform((s) => s || null);

const ZoneFields = z.object({
  symbol,
  kind: z.enum(["BUY", "SELL", "TARGET", "INVALIDATION", "INFO"]),
  low: price,
  high: price,
  direction: z.enum(["ABOVE", "BELOW"]).nullable().default(null),
  closeTf: z.enum(["1H", "4H", "1D"]).nullable().default(null),
  condition: optText(200).default(null),
  explain: optText(300).default(null),
  note: optText(200).default(null),
  uncertain: z.boolean().default(false),
  /** An uncertain zone the owner already checked during review. */
  confirmed: z.boolean().default(false),
});
const checkZone = <T extends { low?: number; high?: number; kind?: string; direction?: string | null }>(zn: T, ctx: z.RefinementCtx) => {
  if (zn.low != null && zn.high != null && zn.low > zn.high) ctx.addIssue({ code: "custom", message: "low must not be above high" });
  if (zn.kind === "INVALIDATION" && !zn.direction) ctx.addIssue({ code: "custom", message: "an invalidation needs a direction (ABOVE or BELOW)" });
};
export const ZoneInput = ZoneFields.superRefine(checkZone);
export const ZonePatch = ZoneFields.partial().superRefine(checkZone);

const Events = z.array(z.object({ at: z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString()), label: z.string().trim().min(1).max(60) })).max(20);
const Offsets = z.record(symbol, z.number().finite());

export const PlanInput = z.object({
  source: z.string().trim().min(1).max(80),
  title: optText(120).default(null),
  rawText: z.string().max(20_000).default(""),
  events: Events.default([]),
  offsets: Offsets.default({}),
  expiresAt: z.iso.datetime({ offset: true }),
  postToChannel: z.boolean().default(false),
  stopPct: z.number().gt(0).max(50).default(13),
  targetPcts: z.array(z.number().gt(0).max(500)).max(6).default([5, 8, 34, 55]),
  zones: z.array(ZoneInput).max(MAX_ZONES).default([]),
});
export const PlanPatch = PlanInput.pick({ source: true, title: true, events: true, offsets: true, expiresAt: true, postToChannel: true, stopPct: true, targetPcts: true }).partial();

/** zod applies field defaults inside .partial(), so a patch keeps only the keys the caller actually sent. */
function sentOnly<T extends object>(raw: unknown, parsed: T): Partial<T> {
  const keys = new Set(raw && typeof raw === "object" ? Object.keys(raw) : []);
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => keys.has(k))) as Partial<T>;
}

type PlanRow = AnalystPlan & { zones: AnalystZone[] };

const zoneDto = (zn: AnalystZone, agrees: string[] = []) => ({
  id: zn.id, symbol: zn.symbol, kind: zn.kind, low: zn.low, high: zn.high, direction: zn.direction, closeTf: zn.closeTf,
  condition: zn.condition, explain: zn.explain, note: zn.note, uncertain: zn.uncertain, confirmed: zn.confirmed, state: zn.state,
  enteredAt: zn.enteredAt?.toISOString() ?? null, enteredPrice: zn.enteredPrice, outcome: zn.outcome, mfe: zn.mfe, mae: zn.mae,
  scoredAt: zn.scoredAt?.toISOString() ?? null, channelMessageId: zn.channelMessageId, channelError: zn.channelError, agrees,
});
export type ZoneDto = ReturnType<typeof zoneDto>;

const planDto = (p: PlanRow, agree: Map<string, string[]> = new Map()) => ({
  id: p.id, source: p.source, title: p.title, status: p.status,
  events: p.events as Array<{ at: string; label: string }>, offsets: p.offsets as Record<string, number>,
  postToChannel: p.postToChannel, stopPct: p.stopPct, targetPcts: p.targetPcts,
  expiresAt: p.expiresAt.toISOString(), activatedAt: p.activatedAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString(),
  zones: p.zones.map((zn) => zoneDto(zn, agree.get(zn.id))),
});
export type PlanDto = ReturnType<typeof planDto>;

const ZONE_ORDER = [{ symbol: "asc" }, { high: "desc" }] satisfies Prisma.AnalystZoneOrderByWithRelationInput[];

async function ownPlan(userId: string, id: string): Promise<PlanRow> {
  const p = await prisma.analystPlan.findFirst({ where: { id, userId }, include: { zones: { orderBy: ZONE_ORDER } } });
  if (!p) throw notFound("plan not found");
  return p;
}
const draftOnly = (p: { status: string }) => {
  if (p.status !== "DRAFT") throw badRequest("only a draft plan can be changed; archive it and paste a new one", "NOT_DRAFT");
};
const zoneData = (zn: z.output<typeof ZoneInput>) => ({
  ...zn,
  direction: zn.kind === "INVALIDATION" ? zn.direction : null,
  closeTf: zn.kind === "INVALIDATION" ? zn.closeTf ?? "4H" : null,
});

export async function createPlan(userId: string, input: z.input<typeof PlanInput>): Promise<PlanDto> {
  const p = PlanInput.parse(input);
  const open = await prisma.analystPlan.count({ where: { userId, status: { not: "ARCHIVED" } } });
  if (open >= MAX_OPEN_PLANS) throw badRequest(`Too many open plans (max ${MAX_OPEN_PLANS}): archive some first`, "LIMIT");
  const row = await prisma.analystPlan.create({
    data: {
      userId, source: p.source, title: p.title, rawText: p.rawText, events: p.events, offsets: p.offsets, expiresAt: new Date(p.expiresAt),
      postToChannel: p.postToChannel, stopPct: p.stopPct, targetPcts: [...p.targetPcts].sort((a, b) => a - b),
      zones: { create: p.zones.map(zoneData) },
    },
    include: { zones: { orderBy: ZONE_ORDER } },
  });
  return planDto(row);
}

/** Field patch on a draft. The channel switch alone may change on an active plan: it does not touch the scoring. */
export async function updatePlan(userId: string, id: string, patch: z.input<typeof PlanPatch>): Promise<PlanDto> {
  const current = await ownPlan(userId, id);
  const p = sentOnly(patch, PlanPatch.parse(patch));
  const onlyChannel = Object.keys(p).length > 0 && Object.keys(p).every((k) => k === "postToChannel");
  if (!(onlyChannel && current.status === "ACTIVE")) draftOnly(current);
  await prisma.analystPlan.update({
    where: { id },
    data: { ...p, expiresAt: p.expiresAt ? new Date(p.expiresAt) : undefined },
  });
  return planDto(await ownPlan(userId, id));
}

export async function addZone(userId: string, planId: string, input: z.input<typeof ZoneInput>): Promise<ZoneDto> {
  const p = await ownPlan(userId, planId);
  draftOnly(p);
  if (p.zones.length >= MAX_ZONES) throw badRequest(`A plan holds at most ${MAX_ZONES} zones`, "LIMIT");
  return zoneDto(await prisma.analystZone.create({ data: { planId, ...zoneData(ZoneInput.parse(input)) } }));
}

async function ownZone(userId: string, zoneId: string) {
  const zn = await prisma.analystZone.findFirst({ where: { id: zoneId, plan: { userId } }, include: { plan: { select: { status: true } } } });
  if (!zn) throw notFound("zone not found");
  draftOnly(zn.plan);
  return zn;
}

export async function updateZone(userId: string, zoneId: string, patch: z.input<typeof ZonePatch>): Promise<ZoneDto> {
  const current = await ownZone(userId, zoneId);
  const p = sentOnly(patch, ZonePatch.parse(patch));
  const merged = ZoneInput.parse({ ...zoneDto(current), ...p });
  return zoneDto(await prisma.analystZone.update({ where: { id: zoneId }, data: zoneData(merged) }));
}

export async function deleteZone(userId: string, zoneId: string): Promise<void> {
  await ownZone(userId, zoneId);
  await prisma.analystZone.delete({ where: { id: zoneId } });
}

/** DRAFT → ACTIVE. Every uncertain zone must be confirmed, and the plan must watch something before it expires. */
export async function activatePlan(userId: string, id: string, now = new Date()): Promise<PlanDto> {
  const p = await ownPlan(userId, id);
  draftOnly(p);
  const open = p.zones.filter((zn) => zn.uncertain && !zn.confirmed);
  if (open.length) throw badRequest(`Confirm or fix ${open.length} uncertain zone${open.length > 1 ? "s" : ""} first`, "UNCONFIRMED");
  if (!p.zones.some((zn) => zn.kind !== "INFO")) throw badRequest("Nothing to watch: add a buy, sell, target or invalidation zone", "EMPTY");
  if (p.expiresAt <= now) throw badRequest("The plan has already expired: set a later expiry", "EXPIRED");
  await prisma.$transaction([
    prisma.analystZone.updateMany({ where: { planId: id }, data: { lastCheckedAt: now } }),
    prisma.analystPlan.updateMany({ where: { id, status: "DRAFT" }, data: { status: "ACTIVE", activatedAt: now } }),
  ]);
  return planDto(await ownPlan(userId, id));
}

export async function archivePlan(userId: string, id: string): Promise<void> {
  await ownPlan(userId, id);
  await prisma.analystPlan.update({ where: { id }, data: { status: "ARCHIVED" } });
}

/** Discard a draft. Active and archived plans are kept for the scorecard. */
export async function deletePlan(userId: string, id: string): Promise<void> {
  const p = await ownPlan(userId, id);
  if (p.status !== "DRAFT") throw badRequest("Only a draft can be deleted; archive an active plan instead", "NOT_DRAFT");
  await prisma.analystPlan.delete({ where: { id } });
}

/** Newest first; agreement is computed across the owner's draft and active plans. */
export async function listPlans(userId: string): Promise<PlanDto[]> {
  const rows = await prisma.analystPlan.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 60, include: { zones: { orderBy: ZONE_ORDER } } });
  const live = rows.filter((p) => p.status !== "ARCHIVED").flatMap((p) => p.zones.map((zn) => ({ ...zn, source: p.source })));
  const agree = agreements(live);
  return rows.map((p) => planDto(p, agree));
}

export interface SourceScore {
  source: string;
  zones: number;
  touched: number;
  respected: number;
  broke: number;
  unclear: number;
  untouched: number;
  targetsHit: number;
  targetsMissed: number;
}

/** Outcomes per source over every scored zone (BUY/SELL reactions and targets). */
export async function scorecard(userId: string): Promise<SourceScore[]> {
  const rows = await prisma.analystZone.findMany({
    where: { plan: { userId }, outcome: { not: null } },
    select: { outcome: true, plan: { select: { source: true } } },
  });
  const by = new Map<string, SourceScore>();
  for (const r of rows) {
    const key = r.plan.source.trim().toLowerCase();
    const s = by.get(key) ?? { source: r.plan.source.trim(), zones: 0, touched: 0, respected: 0, broke: 0, unclear: 0, untouched: 0, targetsHit: 0, targetsMissed: 0 };
    s.zones++;
    if (r.outcome === "RESPECTED") { s.respected++; s.touched++; }
    else if (r.outcome === "BROKE") { s.broke++; s.touched++; }
    else if (r.outcome === "UNCLEAR") { s.unclear++; s.touched++; }
    else if (r.outcome === "UNTOUCHED") s.untouched++;
    else if (r.outcome === "HIT") s.targetsHit++;
    else if (r.outcome === "MISSED") s.targetsMissed++;
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => b.zones - a.zones);
}
