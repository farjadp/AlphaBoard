import "server-only";
import type { Mt5Device } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { notFound } from "@/lib/http/errors";
import { channelFromEnv, type Channel } from "./channel";
import { applyReport, type SignalView } from "./state";
import type { Job, ReportEvent } from "./wire";

/**
 * Signal Desk service (P12). Execution is at most once: a PENDING signal goes to SENT in one conditional update and
 * is never handed out again. Reports are applied under a row lock, so a retried report is a no-op (see state.ts).
 */
const CLAIM_BATCH = 10;

interface Deps { channel?: Channel | null; now?: Date }

/** PENDING signals of the device's owner → SENT for this device, plus queued commands for signals it holds. */
export async function claimJobs(device: Mt5Device, now = new Date()): Promise<Job[]> {
  const jobs: Job[] = [];

  const commands = await prisma.tradeSignal.findMany({
    where: { deviceId: device.id, userId: device.userId, pendingCommand: { not: null } },
    select: { id: true, pendingCommand: true },
  });
  for (const c of commands) {
    const r = await prisma.tradeSignal.updateMany({ where: { id: c.id, pendingCommand: c.pendingCommand }, data: { pendingCommand: null } });
    if (r.count === 1) jobs.push({ kind: "CMD", id: c.id, command: c.pendingCommand as "CLOSE_ALL" | "BREAKEVEN" });
  }

  const pending = await prisma.tradeSignal.findMany({
    where: { userId: device.userId, status: "PENDING", execute: true, expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" },
    take: CLAIM_BATCH,
  });
  for (const s of pending) {
    const r = await prisma.tradeSignal.updateMany({ where: { id: s.id, status: "PENDING" }, data: { status: "SENT", sentAt: now, deviceId: device.id } });
    if (r.count !== 1) continue;
    jobs.push({ kind: "OPEN", id: s.id, symbol: s.symbol, side: s.side as "BUY" | "SELL", entry: s.entry, stop: s.stop, maxDeviation: s.maxDeviation, riskPct: s.riskPct, tps: s.tps });
  }
  return jobs;
}

/** One EA report on a signal this device claimed; 404 for any other device. Posts the channel reply after commit. */
export async function recordReport(device: Mt5Device, signalId: string, e: ReportEvent, deps: Deps = {}): Promise<void> {
  const now = deps.now ?? new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "TradeSignal" WHERE "id" = ${signalId} FOR UPDATE`;
    const s = await tx.tradeSignal.findFirst({ where: { id: signalId, userId: device.userId, deviceId: device.id }, include: { legs: true } });
    if (!s) throw notFound("signal not found");
    const view: SignalView = {
      status: s.status,
      side: s.side as "BUY" | "SELL",
      stop: s.stop,
      breakevenDone: s.breakevenAt != null,
      legs: s.legs.map((l) => ({ leg: l.leg, status: l.status, openPrice: l.openPrice, volume: l.volume, r: l.r })),
    };
    const t = applyReport(view, e);
    if (t.legCreate) await tx.tradeSignalLeg.create({ data: { signalId, ...t.legCreate } });
    if (t.legUpdate) {
      const { leg, ...data } = t.legUpdate;
      await tx.tradeSignalLeg.update({ where: { signalId_leg: { signalId, leg } }, data: { ...data, closedAt: now } });
    }
    await tx.tradeSignal.update({
      where: { id: signalId },
      data: {
        status: t.status as typeof s.status,
        ...(t.reason ? { statusReason: t.reason } : {}),
        ...(t.breakeven ? { breakevenAt: now } : {}),
      },
    });
    return { reply: t.reply, post: s.post, messageId: s.channelMessageId };
  });

  if (!outcome.reply || !outcome.post || outcome.messageId == null) return;
  const channel = deps.channel === undefined ? channelFromEnv() : deps.channel;
  if (!channel) return;
  try {
    await channel.reply(outcome.messageId, outcome.reply);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, signalId }, "signal channel reply failed");
    await prisma.tradeSignal.update({ where: { id: signalId }, data: { channelError: msg.slice(0, 300) } });
  }
}
