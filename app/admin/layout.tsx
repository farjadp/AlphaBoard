import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import AdminNav from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/market");
  const pendingRequests = await prisma.accessRequest.count({ where: { status: "PENDING" } });

  return (
    <div className="min-h-full bg-page text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex flex-wrap items-center gap-4 md:gap-6">
            <Link href="/market" className="flex items-center gap-2 font-display text-[17px] font-extrabold text-ink">
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <rect width="20" height="20" rx="5" className="fill-ink" />
                <path d="M4 14 L8 9 L11 11.5 L16 5" className="stroke-paper" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              AlphaBoard <span className="font-sans text-xs font-bold uppercase tracking-wider text-ink-3">Admin</span>
            </Link>
            <AdminNav pendingRequests={pendingRequests} />
          </div>
          <div className="flex items-center gap-4 text-xs text-ink-3">
            <span className="hidden sm:inline">{user.email}</span>
            <Link href="/market" className="inline-flex min-h-6 items-center font-semibold text-ink-2 hover:text-ink">Back to app →</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">{children}</main>
    </div>
  );
}
