"use client";

import { useState } from "react";
import { fmtPrice, when } from "@/lib/format";
import { api, btnQuiet, deskRes, KIND_LABEL, KIND_TONE, type PlanDto, type ZoneDto } from "./resources";

const STATE_TEXT: Record<ZoneDto["state"], string> = { WAITING: "Waiting", ENTERED: "Entered", BROKEN: "Broken", SCORED: "Scored", EXPIRED: "Expired" };
const OUTCOME_TONE: Record<string, string> = {
  RESPECTED: "text-up", HIT: "text-up", BROKE: "text-down", MISSED: "text-down", UNCLEAR: "text-ink-2", UNTOUCHED: "text-ink-3",
};
const SIGNAL_TEXT: Record<string, string> = {
  WAITING_TRIGGER: "Waiting for trigger", OPEN: "Signal open", CANCELLED: "Trigger cancelled", EXPIRED: "No trigger in 24 h",
  STOP: "Signal: stop hit", BREAKEVEN: "Signal: closed at entry", ALL_TP: "Signal: all targets", TIMEOUT: "Signal: no longer followed",
};
const range = (z: { low: number; high: number }) => (z.low === z.high ? fmtPrice(z.low) : `${fmtPrice(z.low)} – ${fmtPrice(z.high)}`);

function ZoneRow({ z, draft, onError }: { z: ZoneDto; draft: boolean; onError: (m: string) => void }) {
  async function confirm(checked: boolean) {
    try {
      await api(`/api/analyst/zones/${z.id}`, "PATCH", { confirmed: checked });
      await deskRes.load(true);
    } catch (e) { onError(e instanceof Error ? e.message : "Failed"); }
  }
  return (
    <tr className="border-t border-line align-top">
      <td className="py-1.5 pr-3 font-semibold text-ink">{z.symbol}</td>
      <td className="pr-3"><span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${KIND_TONE[z.kind]}`}>{KIND_LABEL[z.kind]}</span></td>
      <td className="pr-3 tabular-nums text-ink">
        {range(z)}
        {z.kind === "INVALIDATION" && <span className="block text-xs text-ink-3">{z.closeTf} close {z.direction === "BELOW" ? "below" : "above"}</span>}
      </td>
      <td className="pr-3 text-xs">
        <span className="font-semibold text-ink-2">{z.kind === "INFO" ? "Not watched" : STATE_TEXT[z.state]}</span>
        {z.outcome && <span className={`ml-1 font-semibold ${OUTCOME_TONE[z.outcome] ?? "text-ink-2"}`}>· {z.outcome.toLowerCase()}</span>}
        {z.enteredPrice != null && <span className="block tabular-nums text-ink-3">at {fmtPrice(z.enteredPrice)}{z.enteredAt ? ` · ${when(z.enteredAt)}` : ""}</span>}
        {z.mfe != null && <span className="block tabular-nums text-ink-3">best {fmtPrice(z.mfe)} · worst {fmtPrice(z.mae ?? 0)}</span>}
        {z.signalState && <span className="block font-semibold text-ink-2">{SIGNAL_TEXT[z.signalState] ?? z.signalState}{z.triggerPrice != null ? ` at ${fmtPrice(z.triggerPrice)}` : ""}{z.tpHit > 0 ? ` · TP${z.tpHit} hit` : ""}</span>}
        {z.channelMessageId != null && <span className="block text-ink-3">posted to channel</span>}
        {z.channelError && <span className="block text-down" title={z.channelError}>channel post failed</span>}
      </td>
      <td className="pr-3 text-xs text-ink-2">
        {z.agrees.length > 0 && <span className="mb-1 inline-block rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">agrees: {z.agrees.join(", ")}</span>}
        {z.condition && <p dir="auto">{z.condition}</p>}
        {z.explain && <p dir="auto" className="text-ink-3">{z.explain}</p>}
        {z.note && <p dir="auto" className="text-ink-3">{z.note}</p>}
      </td>
      <td className="py-1.5 text-xs">
        {draft && z.uncertain && (
          <label className="flex items-center gap-1.5 font-semibold text-amber">
            <input type="checkbox" checked={z.confirmed} onChange={(e) => void confirm(e.target.checked)} /> Confirm
          </label>
        )}
      </td>
    </tr>
  );
}

function PlanCard({ p, channel }: { p: PlanDto; channel: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await f(); await deskRes.load(true); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  };
  const draft = p.status === "DRAFT";
  const offsets = Object.entries(p.offsets).filter(([, v]) => v !== 0);

  return (
    <article className="rounded-lg border border-line p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold text-ink" dir="auto">{p.source}{p.title ? ` · ${p.title}` : ""}</h3>
          <p className="text-xs text-ink-3">
            {p.status === "ACTIVE" ? "Watching" : draft ? "Draft" : "Archived"} · until {when(p.expiresAt)}
            {" "}· trigger {p.triggerTf} · stop {p.stopPct}% · targets {p.targetPcts.join(" / ")}%
            {offsets.length > 0 && <> · offset {offsets.map(([s, v]) => `${s} ${v > 0 ? "+" : ""}${v}`).join(", ")}</>}
            {p.events.length > 0 && <> · events: {p.events.map((e) => `${e.label} ${when(e.at)}`).join(", ")}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {channel && p.status !== "ARCHIVED" && (
            <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
              <input type="checkbox" checked={p.postToChannel} disabled={busy}
                onChange={(e) => run(() => api(`/api/analyst/plans/${p.id}`, "PATCH", { postToChannel: e.target.checked }))} />
              Post to @{channel}
            </label>
          )}
          {draft && <button type="button" className={btnQuiet} disabled={busy} onClick={() => run(() => api(`/api/analyst/plans/${p.id}`, "PATCH", { action: "activate" }))}>Activate</button>}
          {draft && <button type="button" className={btnQuiet} disabled={busy} onClick={() => run(() => api(`/api/analyst/plans/${p.id}`, "DELETE"))}>Delete</button>}
          {p.status === "ACTIVE" && <button type="button" className={btnQuiet} disabled={busy} onClick={() => run(() => api(`/api/analyst/plans/${p.id}`, "PATCH", { action: "archive" }))}>Archive</button>}
        </div>
      </header>
      {error && <p role="alert" className="mt-2 text-sm text-down">{error}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className="py-1 font-semibold">Symbol</th><th className="font-semibold">Kind</th><th className="font-semibold">Zone</th><th className="font-semibold">State</th><th className="font-semibold">Notes</th><th><span className="sr-only">Confirm</span></th></tr></thead>
          <tbody>{p.zones.map((z) => <ZoneRow key={z.id} z={z} draft={draft} onError={setError} />)}</tbody>
        </table>
      </div>
    </article>
  );
}

export function PlanList({ plans, loaded, error, channel }: { plans: PlanDto[]; loaded: boolean; error: string | null; channel: string | null }) {
  const [showArchived, setShowArchived] = useState(false);
  const open = plans.filter((p) => p.status !== "ARCHIVED");
  const archived = plans.filter((p) => p.status === "ARCHIVED");
  return (
    <section aria-labelledby="plans-h" className="space-y-3">
      <h2 id="plans-h" className="font-display text-lg font-bold text-ink">Plans</h2>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      {loaded && open.length === 0 && <p className="text-sm text-ink-3">No plan is being watched. Paste an analysis above to start.</p>}
      {open.map((p) => <PlanCard key={p.id} p={p} channel={channel} />)}
      {archived.length > 0 && (
        <button type="button" className={btnQuiet} onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
          {showArchived ? "Hide" : "Show"} {archived.length} archived
        </button>
      )}
      {showArchived && archived.map((p) => <PlanCard key={p.id} p={p} channel={channel} />)}
    </section>
  );
}
