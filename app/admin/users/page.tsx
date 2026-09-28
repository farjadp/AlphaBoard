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
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-gray-400 mt-1">Daily AI token allowance per user (resets 00:00 UTC). Set 0 to turn AI off for someone.</p>
      </div>
      <section className="rounded-xl border border-gray-800 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-gray-400">
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
                <tr key={u.id} className="border-t border-gray-800">
                  <td className="p-3"><p className="text-gray-100">{u.name ?? "—"}</p><p className="text-xs text-gray-500">{u.email}</p></td>
                  <td className="p-3">{u.role}</td>
                  <td className="p-3 text-gray-300">{u.aiProvider && u.aiModel ? findModel(u.aiProvider, u.aiModel)?.label ?? u.aiModel : <span className="text-gray-500">default</span>}</td>
                  <td className="p-3 text-right tabular-nums">{t.tokens.toLocaleString("en-US")}<span className="block text-xs text-gray-500">≈ ${t.cost.toFixed(3)}</span></td>
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
