"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] route error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="flex min-h-full items-center justify-center bg-page p-6 text-ink">
      <div className="panel w-full max-w-md p-8 text-center">
        <p className="label-caps mb-2 text-down">Something broke</p>
        <h1 className="mb-2 font-display text-2xl font-extrabold text-ink">This page hit an error</h1>
        <p className="mb-6 text-sm text-ink-3">
          The problem has been logged{error.digest ? ` (ref ${error.digest})` : ""}. You can try again or go back to the dashboard.
        </p>
        <div className="flex justify-center gap-3">
          <button onClick={reset} className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-paper hover:bg-ink-hover">
            Try again
          </button>
          <Link href="/market" className="rounded-lg border border-line-2 px-4 py-2 text-sm font-bold text-ink hover:bg-wash">
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
