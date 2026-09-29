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
    <form onSubmit={create} className="panel space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Bind to an email (optional)"
          aria-label="Bind to an email (optional)"
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as "USER" | "ADMIN")}
          aria-label="Role"
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none">
          <option value="USER">User</option>
          <option value="ADMIN">Admin</option>
        </select>
        <button type="submit" disabled={busy}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-paper hover:bg-ink-hover disabled:opacity-50">
          {busy ? "Creating…" : "Create invite"}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-down">{error}</p>}

      {url && (
        <div className="rounded-lg bg-up-soft p-3 text-sm">
          <p className="mb-1 font-semibold text-up">Invite link (shown once — copy it now):</p>
          <div className="flex gap-2">
            <code className="flex-1 break-all font-mono text-xs text-ink">{url}</code>
            <button type="button" onClick={() => navigator.clipboard.writeText(url)}
              className="shrink-0 rounded-lg border border-line-2 bg-paper px-2 py-1 text-xs font-bold text-ink hover:bg-wash">
              Copy
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
