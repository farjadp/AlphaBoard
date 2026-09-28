import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/dal";
import { inviteState } from "@/lib/auth/invites";
import InviteCreator from "@/components/admin/InviteCreator";

export const dynamic = "force-dynamic";

export default async function InvitesPage() {
  await requireAdmin();
  const invites = await prisma.invite.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { usedBy: { select: { email: true } } },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Invites</h1>
        <p className="text-sm text-gray-400 mt-1">Registration is invite-only. Links are single-use and expire after 14 days by default.</p>
      </div>

      <InviteCreator />

      <section className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">State</th>
              <th className="p-3 font-medium">Expires</th>
              <th className="p-3 font-medium">Used by</th>
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-gray-500">No invites yet.</td></tr>
            )}
            {invites.map((i) => {
              const state = inviteState(i);
              return (
                <tr key={i.id} className="border-t border-gray-800">
                  <td className="p-3">{i.email ?? <span className="text-gray-500">any</span>}</td>
                  <td className="p-3">{i.role}</td>
                  <td className="p-3">
                    <span className={
                      state === "valid" ? "text-emerald-400" : state === "used" ? "text-gray-400" : "text-amber-400"
                    }>{state}</span>
                  </td>
                  <td className="p-3 text-gray-400">{i.expiresAt.toISOString().slice(0, 10)}</td>
                  <td className="p-3 text-gray-400">{i.usedBy?.email ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
