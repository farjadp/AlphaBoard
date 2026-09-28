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
      <div className="max-w-md w-full p-8 bg-gray-800 rounded-xl shadow-xl text-center">
        <h1 className="text-2xl font-bold mb-3">Invite required</h1>
        <p className="text-sm text-gray-400 mb-6">
          AlphaBoard is invite-only. Ask an administrator for an invitation link, then open it here.
        </p>
        <a href="/login" className="text-blue-400 hover:underline text-sm">Already have an account? Log in</a>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full p-8 bg-gray-800 rounded-xl shadow-xl">
      <h1 className="text-2xl font-bold text-center mb-1">Create your account</h1>
      <p className="text-center text-xs text-gray-500 mb-6">You were invited to AlphaBoard.</p>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-400 mb-1">Name</label>
          <input id="name" name="name" type="text" required minLength={2} autoComplete="name"
            className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2 focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-400 mb-1">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email"
            className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2 focus:outline-none focus:border-blue-500" />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-400 mb-1">Password <span className="text-gray-600">(10+ characters)</span></label>
          <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password"
            className="w-full bg-gray-900 border border-gray-700 rounded px-4 py-2 focus:outline-none focus:border-blue-500" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors disabled:opacity-50">
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-gray-400">
        Already have an account? <a href="/login" className="text-blue-400 hover:underline">Log in</a>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-4">
      <Suspense fallback={<div className="p-8 text-gray-400">Loading…</div>}>
        <RegisterForm />
      </Suspense>
    </main>
  );
}
