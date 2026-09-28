import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/ai/usage";
import { findModel } from "@/lib/ai/catalog";
import UserQuotaRow from "@/components/admin/UserQuotaRow";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireAdmin();
  const [users, today] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, email: true, name: true, role: true, dailyTokenQuota: true, aiProvider: true, aiModel: true, createdAt: true } }),
    prisma.aiUsage.groupBy({ by: ["userId"], where: { createdAt: { gte: startOfUtcDay() } }, _sum: { inputTokens: true, outputTokens: true, costUsd: true } }),
  ]);
  const used = new Map(today.map((t) => [t.userId, { tokens: (t._sum.inputTokens ?? 0) + (t._sum.outputTokens ?? 0), cost: t._sum.costUsd ?? 0 }]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-ink">Users</h1>
        <p className="mt-1 text-sm text-ink-3">Daily AI token allowance per user (resets 00:00 UTC). Set 0 to turn AI off for someone.</p>
      </div>
      <section className="panel overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-wash text-xs text-ink-3">
            <tr>
              <th className="p-3 font-medium">User</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">Model</th>
              <th className="p-3 font-medium text-right">Used today</th>
              <th className="p-3 font-medium">Daily allowance</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const t = used.get(u.id) ?? { tokens: 0, cost: 0 };
              return (
                <tr key={u.id} className="border-t border-line text-ink">
                  <td className="p-3"><p className="font-semibold text-ink">{u.name ?? "—"}</p><p className="text-xs text-ink-3">{u.email}</p></td>
                  <td className="p-3">{u.role}</td>
                  <td className="p-3 text-ink-2">{u.aiProvider && u.aiModel ? findModel(u.aiProvider, u.aiModel)?.label ?? u.aiModel : <span className="text-ink-3">default</span>}</td>
                  <td className="num p-3 text-right">{t.tokens.toLocaleString("en-US")}<span className="block text-xs text-ink-3">≈ ${t.cost.toFixed(3)}</span></td>
                  <td className="p-3"><UserQuotaRow id={u.id} quota={u.dailyTokenQuota} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
