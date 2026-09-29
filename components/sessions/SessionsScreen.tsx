"use client";

import { useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { useSessions } from "@/hooks/useSessions";
import type { DailyUsageDto, SessionSummaryDto } from "@/lib/types/sessions";
import { END_REASON, StatusPill, durationText, usd } from "./ui";

const ACTIVE = new Set(["RUNNING", "PAUSED", "AWAITING_EXTENSION", "ENDING"]);
const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-ink-2");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function LimitsPanel({ usage, onSave }: { usage: DailyUsageDto; onSave: (l: { maxDailyLoss: number | null; maxSessionsPerDay: number | null }) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [loss, setLoss] = useState(usage.limits.maxDailyLoss == null ? "" : String(usage.limits.maxDailyLoss));
  const [count, setCount] = useState(usage.limits.maxSessionsPerDay == null ? "" : String(usage.limits.maxSessionsPerDay));
  const [error, setError] = useState<string | null>(null);
  const input = "w-28 rounded-lg border border-line bg-wash px-2.5 py-1.5 text-sm tabular-nums text-ink focus:border-accent focus:outline-none";

  return (
    <section className="panel p-5" aria-labelledby="today-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="today-heading" className="text-sm font-semibold text-ink">Today</h2>
          <p className="mt-0.5 text-xs text-ink-3">Limits apply across every session you start today (UTC).</p>
        </div>
        {!editing && <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-accent hover:underline">Edit limits</button>}
      </div>
      {!editing ? (
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <dt className="label-caps">Sessions started</dt>
            <dd className="num mt-1 text-lg font-semibold text-ink">{usage.sessionsToday}<span className="text-sm font-normal text-ink-3"> / {usage.limits.maxSessionsPerDay ?? "no limit"}</span></dd>
          </div>
          <div>
            <dt className="label-caps">Loss today</dt>
            <dd className="num mt-1 text-lg font-semibold text-ink">{usd(usage.lossToday)}<span className="text-sm font-normal text-ink-3"> / {usage.limits.maxDailyLoss == null ? "no limit" : usd(usage.limits.maxDailyLoss)}</span></dd>
          </div>
        </dl>
      ) : (
        <form
          className="mt-4 flex flex-wrap items-end gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const l = loss.trim() === "" ? null : Number(loss);
            const c = count.trim() === "" ? null : Number(count);
            if (l != null && !(l > 0)) { setError("Daily loss limit must be positive"); return; }
            if (c != null && !(Number.isInteger(c) && c >= 1 && c <= 100)) { setError("Sessions per day must be 1–100"); return; }
            try { await onSave({ maxDailyLoss: l, maxSessionsPerDay: c }); setEditing(false); setError(null); } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
          }}
        >
          <label className="text-xs text-ink-2">Max daily loss ($)<br /><input className={input} inputMode="decimal" value={loss} onChange={(e) => setLoss(e.target.value)} placeholder="No limit" /></label>
          <label className="text-xs text-ink-2">Max sessions per day<br /><input className={input} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder="No limit" /></label>
          <button type="submit" className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper hover:bg-ink-hover">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-ink-3">Cancel</button>
          {error && <p role="alert" className="w-full text-xs text-down">{error}</p>}
        </form>
      )}
    </section>
  );
}

function SessionCard({ s }: { s: SessionSummaryDto }) {
  return (
    <Link href={`/sessions/${s.id}`} className="panel block p-4 transition-colors hover:border-line-2 focus-visible:outline-2 focus-visible:outline-accent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{s.name}</p>
          <p className="mt-0.5 text-xs text-ink-3">{s.marketType === "swap" ? "Perpetual" : "Spot"} · paper · {usd(s.capital)} · ends {when(s.endsAt)}</p>
        </div>
        <StatusPill status={s.status} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-ink-3">Realized</dt><dd className={`num font-semibold ${tone(s.netPnl)}`}>{usd(s.netPnl, true)}</dd></div>
        <div><dt className="text-ink-3">Open</dt><dd className="num font-semibold text-ink">{s.openPositions}</dd></div>
        <div><dt className="text-ink-3">AI cost</dt><dd className="num font-semibold text-ink">{usd(s.llmCostUsd)}</dd></div>
      </dl>
    </Link>
  );
}

export default function SessionsScreen() {
  const { sessions, usage, loaded, error, setLimits } = useSessions();
  const active = sessions.filter((s) => ACTIVE.has(s.status));
  const past = sessions.filter((s) => !ACTIVE.has(s.status));

  return (
    <div className="flex h-full flex-col overflow-hidden bg-page">
      <NavBar />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold text-ink">Agent sessions</h1>
              <p className="mt-1 max-w-2xl text-sm text-ink-3">
                Give a team of AI agents a mandate and a time box. They discuss the market in a room you can watch; a rule-based risk engine sizes or vetoes every trade. Paper only for now.
              </p>
            </div>
            <Link href="/sessions/new" className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-ink-hover">New session</Link>
          </header>

          {error && <p role="alert" className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}
          {usage && <LimitsPanel key={`${usage.limits.maxDailyLoss}-${usage.limits.maxSessionsPerDay}`} usage={usage} onSave={setLimits} />}

          <section aria-labelledby="active-heading">
            <h2 id="active-heading" className="mb-3 text-sm font-semibold text-ink">Active</h2>
            {!loaded ? (
              <div className="h-24 animate-pulse rounded-2xl bg-paper" />
            ) : active.length ? (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{active.map((s) => <SessionCard key={s.id} s={s} />)}</div>
            ) : (
              <div className="panel p-6 text-center">
                <p className="text-sm text-ink-2">No session is running.</p>
                <p className="mt-1 text-xs text-ink-3">Start one with a small capital and a short time box to see how the desk behaves.</p>
              </div>
            )}
          </section>

          {past.length > 0 && (
            <section aria-labelledby="past-heading" className="panel overflow-hidden">
              <h2 id="past-heading" className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">Past sessions</h2>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Past sessions table">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      {["Session", "Started", "Length", "Outcome", "Trades", "Net P&L", "AI cost"].map((h) => <th key={h} className="px-4 py-2 label-caps">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {past.map((s) => (
                      <tr key={s.id} className="border-b border-line last:border-0 hover:bg-wash">
                        <td className="px-4 py-2.5"><Link href={`/sessions/${s.id}`} className="font-medium text-ink hover:text-accent">{s.name}</Link></td>
                        <td className="num px-4 py-2.5 text-ink-2">{when(s.startedAt)}</td>
                        <td className="num px-4 py-2.5 text-ink-2">{durationText(Math.round((new Date(s.endedAt ?? s.endsAt).getTime() - new Date(s.startedAt).getTime()) / 60_000))}</td>
                        <td className="px-4 py-2.5"><StatusPill status={s.status} /> <span className="ml-1 text-xs text-ink-3">{s.endReason ? END_REASON[s.endReason] ?? s.endReason : ""}</span></td>
                        <td className="num px-4 py-2.5 text-ink-2">{s.tradesCount}</td>
                        <td className={`num px-4 py-2.5 font-semibold ${tone(s.netPnl)}`}>{usd(s.netPnl, true)}</td>
                        <td className="num px-4 py-2.5 text-ink-2">{usd(s.llmCostUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
