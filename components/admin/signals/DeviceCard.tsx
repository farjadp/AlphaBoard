"use client";

import { useState } from "react";
import { btn, btnQuiet, devicesRes, field, hint, isOnline, label, type DeviceDto } from "./resources";

export type { DeviceDto };

function seen(iso: string | null) {
  if (!iso) return "never connected";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "online";
  if (s < 3600) return `last seen ${Math.round(s / 60)} min ago`;
  return `last seen ${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export function DeviceCard({ devices, error }: { devices: DeviceDto[]; error: string | null }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ label: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setCopied(false);
    try {
      const res = await fetch("/api/signal-desk/devices", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: name || "MT5 terminal" }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
      setFresh({ label: body.device.label, token: body.token });
      setName("");
      await devicesRes.load(true);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); } finally { setBusy(false); }
  }

  async function revoke(d: DeviceDto) {
    if (!window.confirm(`Revoke "${d.label}"? The expert on that terminal stops receiving signals at once.`)) return;
    setMsg(null);
    try {
      const res = await fetch(`/api/signal-desk/devices?id=${encodeURIComponent(d.id)}`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (HTTP ${res.status})`);
      await devicesRes.load(true);
    } catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); }
  }

  async function copy(token: string) {
    try { await navigator.clipboard.writeText(token); setCopied(true); } catch { setMsg("Copy failed; select the token and copy it by hand."); }
  }

  return (
    <section aria-labelledby="sd-terminals" className="panel space-y-5 p-5">
      <h2 id="sd-terminals" className="font-display text-lg font-bold text-ink">Terminals</h2>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      {msg && <p role="alert" className="text-sm text-down">{msg}</p>}

      {devices.length === 0 ? (
        <p className="text-sm text-ink-2">No terminal yet. Add one, then put its token into the SignalCopier expert.</p>
      ) : (
        <ul className="divide-y divide-line">
          {devices.map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0 text-sm">
                <p className="font-bold text-ink">
                  {d.label}
                  {d.tradeMode && (
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-bold ${d.tradeMode === "REAL" ? "bg-down-soft text-down" : "bg-wash text-ink-2"}`}>{d.tradeMode === "REAL" ? "Real money" : d.tradeMode.toLowerCase()}</span>
                  )}
                </p>
                <p className="text-ink-2">
                  {d.login ? <>Account <span className="num">{d.login}</span>{d.server ? ` · ${d.server}` : ""}</> : "Waiting for the first heartbeat"}
                </p>
                {d.balance != null && <p className="text-ink-2">Balance <span className="num">{d.balance.toFixed(2)}</span> {d.currency}</p>}
                <p className={isOnline(d) ? "text-up" : "text-ink-3"}>{seen(d.lastSeenAt)} · token …{d.last4}</p>
              </div>
              <button type="button" className={btnQuiet} onClick={() => revoke(d)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}

      {fresh && (
        <div className="space-y-3 rounded-lg border border-amber bg-amber-soft p-4 text-sm text-ink">
          <p className="font-bold">Token for {fresh.label}: shown only now</p>
          <div className="flex items-center gap-2">
            <code className="num min-w-0 flex-1 break-all rounded bg-paper px-2 py-1 text-xs">{fresh.token}</code>
            <button type="button" className={btnQuiet} onClick={() => copy(fresh.token)}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-ink-2">
            <li>MT5 → Tools → Options → Expert Advisors: allow WebRequest for <code className="num text-ink">{origin}</code></li>
            <li>Attach SignalCopier to any chart. Set InpBaseUrl to the same address and paste this token into InpToken.</li>
            <li>It starts in dry run. Keep it there on a demo account until the test runs pass.</li>
          </ol>
          <button type="button" className={btnQuiet} onClick={() => setFresh(null)}>I saved it</button>
        </div>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="sd-device" className={label}>New terminal</label>
          <input id="sd-device" className={field} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Mac · ePlanet demo" />
          <p className={hint}>Each terminal gets its own token.</p>
        </div>
        <button type="submit" className={`${btn} mb-5`} disabled={busy}>{busy ? "Adding…" : "Add"}</button>
      </form>
    </section>
  );
}
