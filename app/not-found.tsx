import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-950 text-gray-100">
      <div className="max-w-md w-full text-center">
        <p className="text-xs font-semibold tracking-wider text-gray-500 uppercase mb-2">404</p>
        <h1 className="text-2xl font-bold mb-2">Page not found</h1>
        <p className="text-sm text-gray-400 mb-6">The page you asked for does not exist or was moved.</p>
        <Link href="/market" className="inline-block px-4 py-2 rounded-lg bg-gray-100 text-gray-900 text-sm font-semibold hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
