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
        <h1 className="font-display text-2xl font-extrabold text-ink">Invites</h1>
        <p className="mt-1 text-sm text-ink-3">Registration is invite-only. Links are single-use and expire after 14 days by default.</p>
      </div>

      <InviteCreator />

      <section className="panel overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-wash text-xs text-ink-3">
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
              <tr><td colSpan={5} className="p-6 text-center text-ink-3">No invites yet.</td></tr>
            )}
            {invites.map((i) => {
              const state = inviteState(i);
              return (
                <tr key={i.id} className="border-t border-line text-ink">
                  <td className="p-3">{i.email ?? <span className="text-ink-3">any</span>}</td>
                  <td className="p-3">{i.role}</td>
                  <td className="p-3">
                    <span className={
                      state === "valid" ? "rounded bg-up-soft px-1.5 py-0.5 text-xs font-bold text-up" : state === "used" ? "rounded bg-wash px-1.5 py-0.5 text-xs font-bold text-ink-3" : "rounded bg-amber-soft px-1.5 py-0.5 text-xs font-bold text-amber"
                    }>{state}</span>
                  </td>
                  <td className="num p-3 text-ink-2">{i.expiresAt.toISOString().slice(0, 10)}</td>
                  <td className="p-3 text-ink-2">{i.usedBy?.email ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
