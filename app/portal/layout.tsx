import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col hidden md:flex">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-xl font-bold text-blue-500">AlphaBoard</h2>
          <p className="text-sm text-gray-400 mt-1">Trading Workspace</p>
        </div>
        
        <nav className="flex-1 p-4 flex flex-col gap-2">
          <Link href="/portal" className="block px-4 py-2 rounded text-gray-300 hover:bg-gray-700 hover:text-white transition-colors">
            Dashboard
          </Link>
          <Link href="/portal/charts" className="block px-4 py-2 rounded text-gray-300 hover:bg-gray-700 hover:text-white transition-colors">
            My Charts
          </Link>
          <Link href="/portal/journal" className="block px-4 py-2 rounded text-gray-300 hover:bg-gray-700 hover:text-white transition-colors">
            Trading Journal
          </Link>
          <Link href="/portal/academy" className="block px-4 py-2 rounded text-gray-300 hover:bg-gray-700 hover:text-white transition-colors">
            Academy
          </Link>
        </nav>

        <div className="p-4 border-t border-gray-700">
          <div className="mb-4 text-sm text-gray-400">
            Logged in as:<br/>
            <strong className="text-white truncate block" title={session.user?.email || ''}>{session.user?.email}</strong>
          </div>
          <form action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}>
            <button className="w-full text-left px-4 py-2 text-red-400 hover:bg-red-500/10 rounded transition-colors">
              Log Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
