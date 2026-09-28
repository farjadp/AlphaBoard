"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InviteCreator() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"USER" | "ADMIN">("USER");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setUrl(null);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() || undefined, role }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create invite");
      setUrl(json.url);
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Bind to an email (optional)"
          className="bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as "USER" | "ADMIN")}
          className="bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm">
          <option value="USER">User</option>
          <option value="ADMIN">Admin</option>
        </select>
        <button type="submit" disabled={busy}
          className="bg-gray-100 text-gray-900 font-semibold rounded px-4 py-2 text-sm hover:bg-white disabled:opacity-50">
          {busy ? "Creating…" : "Create invite"}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {url && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm">
          <p className="text-emerald-300 font-medium mb-1">Invite link (shown once — copy it now):</p>
          <div className="flex gap-2">
            <code className="flex-1 break-all text-emerald-100 text-xs">{url}</code>
            <button type="button" onClick={() => navigator.clipboard.writeText(url)}
              className="shrink-0 rounded border border-emerald-700 px-2 py-1 text-xs hover:bg-emerald-900">
              Copy
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
