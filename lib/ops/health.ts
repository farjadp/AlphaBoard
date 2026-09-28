/** System health rules for the admin dashboard (pure). */
import { createHash } from "node:crypto";

export type TickState = "never" | "ok" | "degraded" | "late" | "stale";
export interface TickRun { at: string; ms: number; errors?: unknown[] }

/** The tick runs every 60s: >2 missed runs is late, >5 minutes is stale (scheduler down). */
export function tickHealth(last: TickRun | null, now = new Date()) {
  if (!last?.at) return { state: "never" as TickState, ageSec: null };
  const ageSec = Math.max(0, Math.round((now.getTime() - new Date(last.at).getTime()) / 1000));
  const state: TickState = ageSec > 300 ? "stale" : ageSec > 130 ? "late" : (last.errors?.length ?? 0) > 0 ? "degraded" : "ok";
  return { state, ageSec };
}

export type Overall = "ok" | "warn" | "down";

export function overallStatus(s: { db: boolean; tick: TickState; errorsLastHour: number }): Overall {
  if (!s.db || s.tick === "stale") return "down"; // "never" = just booted: warn until the first run
  if (s.tick !== "ok" || s.errorsLastHour > 0) return "warn";
  return "ok";
}

/** Same failure → same key: ids, numbers and quoted values are normalized away. */
export function fingerprint(source: string, message: string): string {
  const normalized = message
    .replace(/\bc[a-z0-9]{8,}\b/gi, "<id>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .slice(0, 300);
  return createHash("sha1").update(`${source}|${normalized}`).digest("hex").slice(0, 16);
}
