import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export default async function JournalPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const logs = await prisma.tradeLog.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Trading Journal</h1>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
          + Log Trade
        </button>
      </div>

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-900/50 text-gray-400 text-sm">
            <tr>
              <th className="p-4 font-medium">Asset</th>
              <th className="p-4 font-medium">Entry</th>
              <th className="p-4 font-medium">Exit</th>
              <th className="p-4 font-medium">PnL</th>
              <th className="p-4 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-gray-500">
                  No trades logged yet. Start journaling to track your performance.
                </td>
              </tr>
            ) : (
              logs.map((log: any) => (
                <tr key={log.id} className="border-t border-gray-700">
                  <td className="p-4">{log.asset}</td>
                  <td className="p-4">{log.entryPrice}</td>
                  <td className="p-4">{log.exitPrice || '-'}</td>
                  <td className="p-4">
                    <span className={log.pnl && log.pnl > 0 ? 'text-green-400' : log.pnl && log.pnl < 0 ? 'text-red-400' : ''}>
                      {log.pnl ? `${log.pnl > 0 ? '+' : ''}${log.pnl}` : '-'}
                    </span>
                  </td>
                  <td className="p-4 text-gray-400 text-sm">{new Date(log.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
