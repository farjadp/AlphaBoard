import { requireAdmin } from "@/lib/auth/dal";
import AnalystDesk from "@/components/admin/analyst/AnalystDesk";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analyst Plans" };

export default async function AnalystPage() {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Analyst Plans</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Paste someone&apos;s weekly analysis. After you check the zones, the worker watches them and sends one message when price reaches a zone or breaks the level that cancels the scenario. Every zone gets an outcome, so each source builds a track record. Nothing here places an order.
        </p>
      </div>
      <AnalystDesk />
    </div>
  );
}
