"use client";

import { useCallback } from "react";
import { createResource, jsonRequest, tempId, useResource } from "@/lib/client/resource";
import type { LessonOutcome, TradeLesson } from "@/lib/types/userData";

export type { LessonOutcome, TradeLesson };

const EMPTY: TradeLesson[] = [];
const lessonsResource = createResource<TradeLesson[]>("/api/lessons", { fallback: EMPTY, select: (j) => (j as { lessons: TradeLesson[] }).lessons });

export function useTradeLessons() {
  const { data: lessons, loaded, error } = useResource(lessonsResource);

  /** One lesson per trade: saving again for the same trade replaces it. */
  const addLesson = useCallback((lesson: Omit<TradeLesson, "id" | "timestamp">) => {
    const tmp: TradeLesson = { ...lesson, id: tempId(), timestamp: new Date().toISOString() };
    return lessonsResource.mutate<{ lesson: TradeLesson }>({
      optimistic: (d) => [tmp, ...d.filter((l) => !lesson.tradeId || l.tradeId !== lesson.tradeId)],
      request: jsonRequest("/api/lessons", "POST", lesson),
      apply: (d, body) => d.map((l) => (l.id === tmp.id ? body.lesson : l)),
    }).catch(() => undefined);
  }, []);

  const removeLesson = useCallback((id: string) => lessonsResource.mutate({
    optimistic: (d) => d.filter((l) => l.id !== id),
    request: jsonRequest(`/api/lessons/${id}`, "DELETE"),
  }).catch(() => undefined), []);

  const clearLessons = useCallback(() => lessonsResource.mutate({
    optimistic: () => [],
    request: jsonRequest("/api/lessons", "DELETE"),
  }).catch(() => undefined), []);

  return { lessons, loaded, error, addLesson, removeLesson, clearLessons };
}
