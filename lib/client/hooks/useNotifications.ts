"use client";

import { useCallback, useEffect } from "react";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";

export interface AppNotification { id: string; type: string; title: string; body: string; data: { href?: string } | null; readAt: string | null; createdAt: string }
type Feed = { items: AppNotification[]; unread: number };

const EMPTY: Feed = { items: [], unread: 0 };
const feed = createResource<Feed>("/api/notifications", { fallback: EMPTY, select: (j) => j as Feed });
const POLL_MS = 30_000;

/** Notifications are produced by the server tick; the bell polls every 30s while a page is open. */
export function useNotifications() {
  const { data, loaded } = useResource(feed);

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") feed.revalidate(Date.now(), POLL_MS - 1_000); }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const markRead = useCallback((ids: string[] | "all") => feed.mutate<Feed>({
    optimistic: (d) => ({
      items: d.items.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)),
      unread: ids === "all" ? 0 : d.items.filter((n) => !n.readAt && !ids.includes(n.id)).length,
    }),
    request: jsonRequest("/api/notifications/read", "POST", ids === "all" ? { all: true } : { ids }),
    apply: (_d, body) => body,
  }).catch(() => undefined), []);

  return { ...data, loaded, markRead };
}
