import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function PortalPage() {
  const session = await auth();
  
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Welcome back, {session.user?.name || 'Trader'}</h1>
      <p className="text-gray-400 mb-8">This is your personal AlphaBoard workspace.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <h3 className="text-xl font-semibold mb-2">Saved Charts</h3>
          <p className="text-gray-400 text-sm mb-4">Access your personal lightweight-charts configurations.</p>
          <a href="/portal/charts" className="text-blue-500 hover:underline">View Charts &rarr;</a>
        </div>
        
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <h3 className="text-xl font-semibold mb-2">Trading Journal</h3>
          <p className="text-gray-400 text-sm mb-4">Log and review your past trades and PnL.</p>
          <a href="/portal/journal" className="text-blue-500 hover:underline">Open Journal &rarr;</a>
        </div>

        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <h3 className="text-xl font-semibold mb-2">Academy</h3>
          <p className="text-gray-400 text-sm mb-4">Continue your education and track your progress.</p>
          <a href="/portal/academy" className="text-blue-500 hover:underline">Go to Academy &rarr;</a>
        </div>
      </div>
    </div>
  );
}
