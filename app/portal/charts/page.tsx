import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export default async function ChartsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const charts = await prisma.userChart.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">My Charts</h1>
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
          + New Chart
        </button>
      </div>

      {charts.length === 0 ? (
        <div className="bg-gray-800 p-8 rounded-xl text-center border border-gray-700">
          <p className="text-gray-400 mb-4">You don't have any saved charts yet.</p>
          <button className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded">
            Create your first chart
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {charts.map((chart: any) => (
            <div key={chart.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700">
              <h3 className="font-semibold">{chart.symbol}</h3>
              <p className="text-sm text-gray-500">{new Date(chart.createdAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
