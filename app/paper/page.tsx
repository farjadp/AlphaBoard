import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import { getSignal } from "@/lib/db/signals";
import { findAsset } from "@/lib/assetCatalog";
import PaperScreen from "@/components/paper/PaperScreen";
import type { TicketPrefill } from "@/components/paper/OrderTicket";

export const dynamic = "force-dynamic";

/** `?signal=<id>` pre-fills the ticket from one of the user's archived AI signals ("Trade on paper"). */
export default async function PaperPage({ searchParams }: { searchParams: Promise<{ signal?: string | string[] }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { signal } = await searchParams;
  const s = typeof signal === "string" ? await getSignal(user.id, signal) : null;

  let prefill: TicketPrefill | null = null;
  if (s && findAsset(s.symbol)) {
    const lev = Number.parseFloat(s.risk_management?.leverage ?? "");
    prefill = {
      signalId: s.id,
      label: `${s.signal} ${s.symbol} · ${s.timeframe} · ${new Date(s.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      symbol: s.symbol,
      side: s.signal === "SELL" ? "SHORT" : s.signal === "BUY" ? "LONG" : null,
      stopLoss: s.signal === "HOLD" ? null : s.stopLoss,
      takeProfit: s.signal === "HOLD" ? null : s.takeProfit,
      leverage: Number.isFinite(lev) ? Math.min(20, Math.max(1, Math.round(lev))) : 1,
    };
  }
  return <PaperScreen prefill={prefill} />;
}
