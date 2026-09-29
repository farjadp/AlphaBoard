import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { recordEvent } from "@/lib/ops/events";
import { telegramFromEnv } from "@/lib/notify/telegram";

/**
 * Background work (spec E8): the 60 s tick, the 15 s session monitor (stops, loss limit, end prompts,
 * decision cycles) and Telegram long-polling. Exactly one process runs it, guarded by a lease row that
 * the holder renews; another process takes over when the lease expires.
 *
 * WORKER_MODE=inline (default): started by instrumentation.ts inside the web process.
 * WORKER_MODE=separate: the web process starts nothing; run `npm run worker`.
 */
export const LEASE_KEY = "worker.lease";
export const HEARTBEAT_KEY = "worker.last";
const LEASE_MS = 45_000;
const MONITOR_MS = 15_000;
const TICK_MS = 60_000;

const g = globalThis as unknown as { __alphaboardWorker?: { stop: () => Promise<void> } };

/** Take or renew the lease. True when this process holds it. */
export async function acquireLease(id: string, now = Date.now()): Promise<boolean> {
  const value = JSON.stringify({ id, until: now + LEASE_MS, pid: process.pid });
  const rows = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt") VALUES (${LEASE_KEY}, ${value}::jsonb, now())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
    WHERE ("AppSetting"."value"->>'until')::bigint < ${now} OR "AppSetting"."value"->>'id' = ${id}
    RETURNING "key"`;
  return rows.length === 1;
}

export async function releaseLease(id: string) {
  await prisma.$executeRaw`DELETE FROM "AppSetting" WHERE "key" = ${LEASE_KEY} AND "value"->>'id' = ${id}`;
}

function loop(name: string, everyMs: number, fn: () => Promise<unknown>, isLeader: () => boolean, stopped: () => boolean) {
  let running = false;
  const timer = setInterval(async () => {
    if (running || stopped() || !isLeader()) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error({ err: msg, loop: name }, "worker loop failed");
      await recordEvent({ source: "worker", message: `${name} failed: ${msg}` }).catch(() => undefined);
    } finally {
      running = false;
    }
  }, everyMs);
  timer.unref?.();
  return timer;
}

export function startWorker() {
  if (g.__alphaboardWorker || process.env.VITEST) return;
  const id = randomUUID();
  let leader = false;
  let stopped = false;
  const isLeader = () => leader;
  const isStopped = () => stopped;

  const renew = async () => {
    try {
      const was = leader;
      leader = await acquireLease(id);
      if (leader && !was) logger.info({ id }, "worker lease acquired");
      if (!leader && was) logger.warn({ id }, "worker lease lost");
    } catch (e) {
      leader = false;
      logger.error({ err: e instanceof Error ? e.message : String(e) }, "worker lease check failed");
    }
  };
  const leaseTimer = setInterval(renew, LEASE_MS / 3);
  leaseTimer.unref?.();

  const timers = [leaseTimer];
  if (process.env.TICK_DISABLED !== "1") {
    timers.push(loop("tick", TICK_MS, async () => (await import("@/lib/jobs/tick")).runTick(), isLeader, isStopped));
  }
  timers.push(loop("sessions", MONITOR_MS, async () => {
    const { monitorSessions } = await import("@/lib/sessions/monitor");
    const r = await monitorSessions();
    const value = { at: new Date().toISOString(), pid: process.pid, sessions: r.sessions, exits: r.exits.length, errors: r.errors.slice(0, 5) } as Prisma.InputJsonValue;
    await prisma.appSetting.upsert({ where: { key: HEARTBEAT_KEY }, create: { key: HEARTBEAT_KEY, value }, update: { value } });
    if (r.errors.length) logger.warn({ errors: r.errors.slice(0, 5) }, "session monitor errors");
  }, isLeader, isStopped));

  // Telegram long-poll: one request in flight at a time, only on the leader.
  const telegram = telegramFromEnv();
  const poll = async () => {
    const { processTelegramUpdates } = await import("@/lib/notify/telegramLink");
    while (!stopped) {
      if (!leader || !telegram) {
        await new Promise((r) => setTimeout(r, 5_000).unref?.());
        continue;
      }
      try {
        await processTelegramUpdates(telegram, new Date(), 25);
      } catch (e) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) }, "telegram poll failed");
        await new Promise((r) => setTimeout(r, 5_000).unref?.());
      }
    }
  };
  if (telegram) void poll();

  void renew();
  g.__alphaboardWorker = {
    stop: async () => {
      stopped = true;
      timers.forEach(clearInterval);
      if (leader) await releaseLease(id).catch(() => undefined);
      g.__alphaboardWorker = undefined;
    },
  };
  logger.info({ mode: process.env.WORKER_MODE ?? "inline", telegram: !!telegram, tick: process.env.TICK_DISABLED !== "1" }, "worker started");
  return g.__alphaboardWorker;
}
