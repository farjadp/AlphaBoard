"use client";

import { useCallback, useEffect } from "react";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";
import type { PaperOverview, PaperSide } from "@/lib/types/paper";

const paperResource = createResource<PaperOverview | null>("/api/paper/account", {
  fallback: null,
  select: (j) => j as PaperOverview,
});

const REFRESH_MS = 15_000;

export interface OrderTicket {
  symbol: string;
  side: PaperSide;
  margin: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
  signalId?: string;
}

/** The paper account, re-marked every 15s while on screen (the tick settles SL/TP server-side). */
export function usePaper() {
  const { data, loaded, error } = useResource(paperResource);

  useEffect(() => {
    const t = setInterval(() => paperResource.revalidate(Date.now(), REFRESH_MS - 1_000), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const placeOrder = useCallback((t: OrderTicket) => paperResource.mutate<{ overview: PaperOverview }>({
    request: jsonRequest("/api/paper/orders", "POST", t),
    apply: (_d, body) => body.overview,
  }), []);

  const closePosition = useCallback((id: string) => paperResource.mutate<PaperOverview>({
    request: jsonRequest(`/api/paper/positions/${id}/close`, "POST"),
    apply: (_d, body) => body,
  }), []);

  const updateExits = useCallback((id: string, exits: { stopLoss: number | null; takeProfit: number | null }) =>
    paperResource.mutate<PaperOverview>({
      request: jsonRequest(`/api/paper/positions/${id}`, "PATCH", exits),
      apply: (_d, body) => body,
    }), []);

  const resetAccount = useCallback((startingBalance: number) => paperResource.mutate<PaperOverview>({
    request: jsonRequest("/api/paper/account", "POST", { startingBalance }),
    apply: (_d, body) => body,
  }), []);

  return { overview: data, loaded, error, placeOrder, closePosition, updateExits, resetAccount };
}
