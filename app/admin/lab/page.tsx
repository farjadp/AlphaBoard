import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/client";
import { ASSET_CATALOG } from "@/lib/market/catalog";
import LabWorkbench from "@/components/admin/lab/LabWorkbench";

export const dynamic = "force-dynamic";
export const metadata = { title: "Strategy Lab" };

export default async function LabPage() {
  const admin = await requireAdmin();
  const connections = await prisma.exchangeConnection.findMany({ where: { userId: admin.id, provider: "oanda" }, select: { id: true, label: true }, orderBy: { createdAt: "asc" } });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Strategy Lab</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">Test a trading rule and its money management on real past prices before real money touches it. Every figure counts open positions, includes costs, and shows how much of the result is luck.</p>
      </div>
      <LabWorkbench
        binanceSymbols={ASSET_CATALOG.filter((a) => a.binanceSymbol).map((a) => a.symbol)}
        oandaSymbols={ASSET_CATALOG.filter((a) => a.category === "forex" || a.category === "commodities").map((a) => a.symbol)}
        oandaConnections={connections}
      />
    </div>
  );
}
