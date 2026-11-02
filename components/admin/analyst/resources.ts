import { createResource } from "@/lib/client/resource";
import type { PlanDraft } from "@/lib/analyst/extract";
import type { PlanDto, SourceScore, ZoneDto } from "@/lib/analyst/store";

export type { PlanDraft, PlanDto, SourceScore, ZoneDto };

export interface ExtractResult { draft: PlanDraft; feed: Record<string, number | null>; futures: string[] }
export interface DeskData { plans: PlanDto[]; scores: SourceScore[] }

export const deskRes = createResource<DeskData>("/api/analyst/plans", { fallback: { plans: [], scores: [] }, select: (j) => j as DeskData });

export async function api<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (HTTP ${res.status})`);
  return json as T;
}

export const KIND_LABEL: Record<ZoneDto["kind"], string> = { BUY: "Buy zone", SELL: "Sell zone", TARGET: "Target", INVALIDATION: "Invalidation", INFO: "Info" };
export const KIND_TONE: Record<ZoneDto["kind"], string> = {
  BUY: "bg-up-soft text-up", SELL: "bg-down-soft text-down", TARGET: "bg-accent-soft text-accent", INVALIDATION: "bg-amber-soft text-amber", INFO: "bg-wash text-ink-2",
};

export const btn = "rounded-lg bg-ink px-4 py-2 text-sm font-bold text-paper hover:bg-ink-hover disabled:opacity-50";
export const btnQuiet = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-wash hover:text-ink disabled:opacity-50";
export const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";
export const cell = "min-w-0 rounded-md border border-line bg-paper px-2 py-1 text-sm tabular-nums text-ink focus:border-accent focus:outline-none";
export const label = "mb-1 block text-xs font-semibold text-ink-2";
export const hint = "mt-1 text-xs text-ink-3";
