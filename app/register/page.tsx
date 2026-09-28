"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function RegisterForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, token }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const first = json.errors ? Object.values<string[]>(json.errors)[0]?.[0] : undefined;
        setError(first ?? json.error ?? "Registration failed");
        setLoading(false);
        return;
      }
      router.push("/login?registered=true");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="panel w-full max-w-md p-8 text-center">
        <p className="mb-6 text-center font-display text-2xl font-extrabold text-ink">AlphaBoard</p>
        <h1 className="mb-3 text-lg font-bold text-ink">Invite required</h1>
        <p className="mb-6 text-sm text-ink-3">
          AlphaBoard is invite-only. Ask an administrator for an invitation link, then open it here.
        </p>
        <a href="/login" className="text-sm font-semibold text-accent hover:underline">Already have an account? Log in</a>
      </div>
    );
  }

  return (
    <div className="panel w-full max-w-md p-8">
      <p className="mb-6 text-center font-display text-2xl font-extrabold text-ink">AlphaBoard</p>
      <h1 className="mb-1 text-center text-lg font-bold text-ink">Create your account</h1>
      <p className="mb-6 text-center text-xs text-ink-3">You were invited to AlphaBoard.</p>

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-down-soft p-3 text-sm text-down">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-semibold text-ink-2">Name</label>
          <input id="name" name="name" type="text" required minLength={2} autoComplete="name"
            className="w-full rounded-lg border border-line bg-paper px-4 py-2 text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none" />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-semibold text-ink-2">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email"
            className="w-full rounded-lg border border-line bg-paper px-4 py-2 text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none" />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-semibold text-ink-2">Password <span className="font-normal text-ink-3">(10+ characters)</span></label>
          <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password"
            className="w-full rounded-lg border border-line bg-paper px-4 py-2 text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full rounded-lg bg-ink px-4 py-2.5 font-bold text-paper transition-colors hover:bg-[#23313f] disabled:opacity-50">
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-ink-3">
        Already have an account? <a href="/login" className="font-semibold text-accent hover:underline">Log in</a>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-4 text-ink">
      <Suspense fallback={<div className="p-8 text-ink-3">Loading…</div>}>
        <RegisterForm />
      </Suspense>
    </main>
  );
}
