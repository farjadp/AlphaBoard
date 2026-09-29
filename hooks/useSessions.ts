"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { createResource, jsonRequest, useResource, type Resource } from "@/lib/client/resource";
import type { DailyUsageDto, SessionMessageDto, SessionReportDto, SessionSummaryDto, SessionViewDto } from "@/lib/types/sessions";

// ─── List + daily usage ──────────────────────────────────────────────────────

interface SessionsList { sessions: SessionSummaryDto[]; usage: DailyUsageDto | null }

const listResource = createResource<SessionsList>("/api/sessions", {
  fallback: { sessions: [], usage: null },
  select: (j) => j as SessionsList,
});

export function useSessions() {
  const { data, loaded, error } = useResource(listResource);
  useEffect(() => {
    const t = setInterval(() => listResource.revalidate(Date.now(), 14_000), 15_000);
    return () => clearInterval(t);
  }, []);
  const setLimits = useCallback((l: { maxDailyLoss: number | null; maxSessionsPerDay: number | null }) => listResource.mutate<DailyUsageDto>({
    request: jsonRequest("/api/sessions/limits", "PUT", l),
    apply: (d, usage) => ({ ...d, usage }),
  }), []);
  return { ...data, loaded, error, setLimits };
}

export async function startSessionRequest(body: { name?: string; mandate: Record<string, unknown>; confirmLive?: string }): Promise<SessionViewDto> {
  const res = await jsonRequest("/api/sessions", "POST", body)();
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Request failed (HTTP ${res.status})`);
  listResource.reset();
  return json as SessionViewDto;
}

// ─── One session: view (polled) ──────────────────────────────────────────────

const views = new Map<string, Resource<SessionViewDto | null>>();
const viewOf = (id: string) => {
  let r = views.get(id);
  if (!r) {
    r = createResource<SessionViewDto | null>(`/api/sessions/${id}`, { fallback: null, select: (j) => j as SessionViewDto });
    views.set(id, r);
  }
  return r;
};

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

export function useSessionView(id: string) {
  const resource = viewOf(id);
  const { data, loaded, error } = useResource(resource);
  useEffect(() => {
    const t = setInterval(() => { if (!hidden()) resource.revalidate(Date.now(), 4_000); }, 5_000);
    return () => clearInterval(t);
  }, [resource]);

  const control = useCallback((body: { action: "pause" | "resume" | "kill" } | { action: "extend"; minutes: number } | { action: "end"; mode: "CLOSE_ALL" | "KEEP_WITH_STOPS" }) =>
    resource.mutate<SessionViewDto>({ request: jsonRequest(`/api/sessions/${id}/control`, "POST", body), apply: (_d, v) => v }), [id, resource]);

  const positionAction = useCallback((positionId: string, action: "close" | "close_half" | "breakeven") =>
    resource.mutate<SessionViewDto>({ request: jsonRequest(`/api/sessions/positions/${positionId}`, "POST", { action }), apply: (_d, v) => v }), [resource]);

  return { view: data, loaded, error, control, positionAction };
}

// ─── One session: room messages (cursor-polled, append-only) ─────────────────

interface RoomState { messages: SessionMessageDto[]; loaded: boolean; error: string | null }

function createRoom(id: string) {
  let state: RoomState = { messages: [], loaded: false, error: null };
  const listeners = new Set<() => void>();
  let inflight = false;
  const set = (s: Partial<RoomState>) => { state = { ...state, ...s }; listeners.forEach((l) => l()); };
  async function poll() {
    if (inflight) return;
    inflight = true;
    try {
      const after = state.messages.at(-1)?.id;
      const res = await fetch(`/api/sessions/${id}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`, { credentials: "same-origin" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const fresh = (json?.messages ?? []) as SessionMessageDto[];
      if (fresh.length || !state.loaded || state.error) set({ messages: fresh.length ? [...state.messages, ...fresh] : state.messages, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : "Failed to load messages" });
    } finally {
      inflight = false;
    }
  }
  return {
    subscribe(l: () => void) { listeners.add(l); if (!state.loaded) void poll(); return () => { listeners.delete(l); }; },
    getSnapshot: () => state,
    poll,
  };
}

const rooms = new Map<string, ReturnType<typeof createRoom>>();
const EMPTY: RoomState = { messages: [], loaded: false, error: null };

export function useRoom(id: string) {
  const room = useMemo(() => {
    let r = rooms.get(id);
    if (!r) { r = createRoom(id); rooms.set(id, r); }
    return r;
  }, [id]);
  const state = useSyncExternalStore(room.subscribe, room.getSnapshot, () => EMPTY);
  useEffect(() => {
    const t = setInterval(() => { if (!hidden()) void room.poll(); }, 3_000);
    return () => clearInterval(t);
  }, [room]);
  return state;
}

// ─── Report ──────────────────────────────────────────────────────────────────

const reports = new Map<string, Resource<SessionReportDto | null>>();

/** Mount only when the session has a report (the endpoint 404s before that). */
export function useSessionReport(id: string) {
  const resource = useMemo(() => {
    let r = reports.get(id);
    if (!r) {
      r = createResource<SessionReportDto | null>(`/api/sessions/${id}/report`, { fallback: null, select: (j) => j as SessionReportDto });
      reports.set(id, r);
    }
    return r;
  }, [id]);
  return useResource(resource);
}
