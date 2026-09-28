import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-6 text-ink">
      <div className="panel w-full max-w-md p-8 text-center">
        <p className="label-caps mb-2">404</p>
        <h1 className="mb-2 font-display text-2xl font-extrabold text-ink">Page not found</h1>
        <p className="mb-6 text-sm text-ink-3">The page you asked for does not exist or was moved.</p>
        <Link href="/market" className="inline-block rounded-lg bg-ink px-4 py-2 text-sm font-bold text-paper hover:bg-[#23313f]">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
