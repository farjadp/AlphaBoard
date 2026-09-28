import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/dal";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/market");

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="border-b border-line bg-paper">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/market" className="font-display text-[17px] font-extrabold text-ink">AlphaBoard</Link>
            <nav aria-label="Admin" className="flex gap-1 text-[13px] font-semibold text-ink-2">
              <Link href="/admin/invites" className="rounded-lg px-3 py-1.5 hover:bg-wash hover:text-ink">Invites</Link>
              <Link href="/admin/users" className="rounded-lg px-3 py-1.5 hover:bg-wash hover:text-ink">Users</Link>
              <Link href="/admin/ai" className="rounded-lg px-3 py-1.5 hover:bg-wash hover:text-ink">AI</Link>
            </nav>
          </div>
          <span className="text-xs text-ink-3">{user.email} · admin</span>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
