"use client";

import { useCallback } from "react";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";
import type { Annotation, AnnotationCategory, AnnotationType, ChartLesson, Timeframe, TimeframeChart } from "@/lib/types/userData";

export type { Annotation, AnnotationCategory, AnnotationType, ChartLesson, Timeframe, TimeframeChart };

const EMPTY: ChartLesson[] = [];
const academyResource = createResource<ChartLesson[]>("/api/chart-lessons", { fallback: EMPTY, select: (j) => (j as { lessons: ChartLesson[] }).lessons });

export function useChartAcademy() {
  const { data: lessons, loaded, error } = useResource(academyResource);

  /**
   * Saves the study with its chart screenshots (uploaded as attachments on the server).
   * Resolves to the new lesson id; rejects with a user-facing message.
   */
  const addLesson = useCallback(async (lesson: Omit<ChartLesson, "id" | "createdAt">) => {
    const body = await academyResource.mutate<{ lesson: ChartLesson }>({
      request: jsonRequest("/api/chart-lessons", "POST", lesson),
      apply: (d, b) => [b.lesson, ...d],
    });
    return body.lesson.id;
  }, []);

  const removeLesson = useCallback((id: string) => academyResource.mutate({
    optimistic: (d) => d.filter((l) => l.id !== id),
    request: jsonRequest(`/api/chart-lessons/${id}`, "DELETE"),
  }).catch(() => undefined), []);

  const clearLessons = useCallback(() => academyResource.mutate({
    optimistic: () => [],
    request: jsonRequest("/api/chart-lessons", "DELETE"),
  }).catch(() => undefined), []);

  return { lessons, hydrated: loaded, error, addLesson, removeLesson, clearLessons };
}
