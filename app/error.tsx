"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] route error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gray-950 text-gray-100">
      <div className="max-w-md w-full rounded-2xl border border-gray-800 bg-gray-900 p-8 text-center">
        <p className="text-xs font-semibold tracking-wider text-red-400 uppercase mb-2">Something broke</p>
        <h1 className="text-xl font-bold mb-2">This page hit an error</h1>
        <p className="text-sm text-gray-400 mb-6">
          The problem has been logged{error.digest ? ` (ref ${error.digest})` : ""}. You can try again or go back to the dashboard.
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={reset} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-900 text-sm font-semibold hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300">
            Try again
          </button>
          <a href="/market" className="px-4 py-2 rounded-lg border border-gray-700 text-sm font-semibold hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">
            Dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
