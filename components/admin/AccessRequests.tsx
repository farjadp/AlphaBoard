"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface AccessRequestRow { id: string; email: string; name: string | null; note: string | null; status: "PENDING" | "INVITED" | "DISMISSED"; createdAt: string }

/** Waitlist from the landing page: turn a request into an email-bound invite (link shown once) or dismiss it. */
export default function AccessRequests({ rows }: { rows: AccessRequestRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "invite" | "dismiss") {
    setBusy(id); setError(null);
    try {
      const res = await fetch(`/api/admin/access-requests/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
      if (action === "invite") setLinks((l) => ({ ...l, [id]: body.url }));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const pending = rows.filter((r) => r.status === "PENDING");
  return (
    <section className="panel overflow-hidden" aria-labelledby="ar-title">
      <div className="flex items-baseline justify-between border-b border-line bg-wash px-4 py-3">
        <h2 id="ar-title" className="text-sm font-semibold text-ink">Access requests <span className="font-normal text-ink-3">· {pending.length} waiting</span></h2>
        <span className="text-xs text-ink-3">From the public landing page</span>
      </div>
      {error && <p role="alert" className="px-4 pt-3 text-sm text-down">{error}</p>}
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-3">No requests yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{r.email}{r.name && <span className="font-normal text-ink-3"> · {r.name}</span>}</p>
                {r.note && <p className="mt-0.5 max-w-xl text-ink-2">{r.note}</p>}
                <p className="mt-0.5 text-xs text-ink-3">{new Date(r.createdAt).toLocaleString()}{r.status !== "PENDING" && ` · ${r.status.toLowerCase()}`}</p>
                {links[r.id] && (
                  <p className="mt-2 text-xs text-ink-2">Invite link (shown once, send it to {r.email}): <span className="select-all break-all font-mono text-ink">{links[r.id]}</span></p>
                )}
              </div>
              {r.status === "PENDING" && (
                <div className="flex gap-2">
                  <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "invite")} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-50">Create invite</button>
                  <button type="button" disabled={busy === r.id} onClick={() => act(r.id, "dismiss")} className="rounded-lg border border-line-2 px-3 py-1.5 text-xs font-semibold text-ink-2 disabled:opacity-50">Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
