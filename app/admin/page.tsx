import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/dal";
import { systemOverview, type SystemOverview } from "@/lib/ops/overview";
import HealthStrip from "@/components/admin/system/HealthStrip";
import AutoRefresh from "@/components/admin/system/AutoRefresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "System" };

type Ok = Extract<SystemOverview, { db: true }>;

const ago = (sec: number | null) =>
  sec == null ? "never" : sec < 90 ? `${sec} s ago` : sec < 5400 ? `${Math.round(sec / 60)} min ago` : `${Math.round(sec / 3600)} h ago`;
const uptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 172_800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86_400)} days`);
const dur = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const time = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

const TONE = {
  ok: { dot: "bg-up", text: "text-up", label: "Normal" },
  warn: { dot: "bg-amber", text: "text-amber", label: "Needs a look" },
  down: { dot: "bg-down", text: "text-down", label: "Problem" },
} as const;

function headline(o: Ok): string {
  const t = o.tick;
  if (t.state === "stale") return `The scheduler has not run for ${ago(t.ageSec).replace(" ago", "")}. Stops, targets, alerts and signal grading are paused.`;
  if (t.state === "never") return "Waiting for the first scheduler run (it starts within a minute of boot).";
  if (t.state === "late") return `The last scheduler run was ${ago(t.ageSec)}; runs are expected every minute.`;
  if (t.state === "degraded") return `The last scheduler run reported ${t.last?.errors.length ?? 0} error(s). See Recent errors.`;
  if (o.errorsLastHour > 0) return `${o.errorsLastHour} server error${o.errorsLastHour === 1 ? "" : "s"} in the last hour. See Recent errors.`;
  return "Everything is running normally.";
}

function Row({ label, value, hint, href }: { label: string; value: React.ReactNode; hint?: string; href?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-ink-2">{label}{hint && <span className="block text-xs text-ink-3">{hint}</span>}</dt>
      {/* Monospace only for figures; words stay in the text face. */}
      <dd className={`text-sm font-semibold text-ink ${typeof value === "number" || (typeof value === "string" && /^[\d$−-]/.test(value)) ? "num" : ""}`}>{href ? <Link href={href} className="underline decoration-dotted underline-offset-2 hover:text-accent">{value}</Link> : value}</dd>
    </div>
  );
}

function Panel({ title, aside, children, className = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel p-5 ${className}`} aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default async function SystemPage() {
  await requireAdmin();
  const o = await systemOverview();

  if (!o.db) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-extrabold text-ink">System</h1>
        <p role="alert" className="panel border-down p-5 text-sm text-down">The database is not reachable. Nothing else can be checked until it is back. {time(o.now)}</p>
        <AutoRefresh />
      </div>
    );
  }

  const tone = TONE[o.status];
  const last = o.tick.last;
  const tickTone = o.tick.state === "ok" ? "text-up" : o.tick.state === "degraded" || o.tick.state === "late" || o.tick.state === "never" ? "text-amber" : "text-down";

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-ink">System</h1>
          <p className="mt-2 flex items-start gap-2.5 text-[15px] text-ink">
            <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
            <span><span className={`font-bold ${tone.text}`}>{tone.label}.</span> {headline(o)}</span>
          </p>
        </div>
        <p className="text-xs text-ink-3">
          Version <span className="num text-ink-2">{o.runtime.version}</span> · up {uptime(o.runtime.uptimeSec)} · Node {o.runtime.node} · updated {new Date(o.now).toLocaleTimeString("en-US", { hour12: false })}, refreshes every 30 s
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          title="Scheduler" className="lg:col-span-2"
          aside={<span className={`text-xs font-bold uppercase tracking-wider ${tickTone}`}>{o.tick.state === "ok" ? "Running" : o.tick.state}</span>}
        >
          <p className="mb-4 text-sm text-ink-2">
            Last run <span className="font-semibold text-ink">{ago(o.tick.ageSec)}</span>
            {last && <> · took <span className="num">{dur(last.ms)}</span></>} · runs every 60 s in this server
            {!o.runtime.schedulerEnabled && <span className="font-semibold text-down"> · disabled by TICK_DISABLED</span>}
            {o.runtime.cronSecret && <> · external trigger enabled</>}
          </p>
          <HealthStrip runs={o.tick.history} />
          {last && (
            <dl className="mt-4 grid gap-x-8 border-t border-line pt-3 sm:grid-cols-2">
              <Row label="Paper positions checked" value={`${last.positions}${last.closed.length ? ` · ${last.closed.length} closed` : ""}`} />
              <Row label="Signals checked" value={last.signals ? `${last.signals.checked} · ${last.signals.resolved} resolved` : "—"} />
              <Row label="Price alerts checked" value={last.alerts ? `${last.alerts.active} · ${last.alerts.fired} fired` : "—"} />
              <Row label="Telegram" value={!o.runtime.telegram ? "Off (no bot token)" : last.telegram ? `${last.telegram.updates} messages · ${last.telegram.linked} linked` : "No messages"} />
            </dl>
          )}
        </Panel>

        <Panel title="People">
          <dl className="divide-y divide-line">
            <Row label="Users" value={o.people.users} hint={`${o.people.admins} admin${o.people.admins === 1 ? "" : "s"}`} href="/admin/users" />
            <Row label="Joined this week" value={o.people.newUsers} />
            <Row label="Accepted the disclaimer" value={`${o.people.accepted} of ${o.people.users}`} />
            <Row label="Telegram linked" value={o.people.telegramLinked} />
            <Row label="Access requests waiting" value={o.people.pendingRequests} href="/admin/invites" />
            <Row label="Unused invites" value={o.people.validInvites} href="/admin/invites" />
          </dl>
        </Panel>

        <Panel title="Workload">
          <dl className="divide-y divide-line">
            <Row label="Open paper positions" value={o.workload.openPositions} hint={`${o.workload.paperAccounts} paper account${o.workload.paperAccounts === 1 ? "" : "s"}`} />
            <Row label="Active price alerts" value={o.workload.activeAlerts} />
            <Row label="Signals awaiting an outcome" value={o.workload.pendingSignals} />
            <Row label="Signals graded this week" value={o.workload.resolvedSignals7d} />
          </dl>
        </Panel>

        <Panel title="AI · last 7 days" className="lg:col-span-2" aside={<Link href="/admin/ai" className="inline-flex min-h-6 items-center text-xs font-semibold text-accent hover:underline">Details & settings →</Link>}>
          <div className="grid gap-x-8 sm:grid-cols-2">
            <dl className="divide-y divide-line">
              <Row label="Default model" value={o.ai.defaultModel} />
              <Row label="Calls" value={`${o.ai.week.calls} · ${o.ai.todayCalls} today`} />
              <Row label="Failed calls" value={o.ai.week.errors} />
              <Row label="Refusals answered by a fallback" value={o.ai.week.fallbacks} />
            </dl>
            <dl className="divide-y divide-line">
              <Row label="Estimated cost" value={`${usd(o.ai.week.costUsd)} · ${usd(o.ai.todayCostUsd)} today`} />
              <Row label="Tokens" value={o.ai.week.tokens.toLocaleString("en-US")} />
              <div className="py-2">
                <dt className="text-sm text-ink-2">Providers</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {o.ai.providers.map((p) => (
                    <span key={p.id} className={`rounded-md px-2 py-0.5 text-xs font-semibold ${p.configured ? "bg-up-soft text-up" : "bg-wash text-ink-3"}`}>
                      {p.label}{p.configured ? "" : " · no key"}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </div>
        </Panel>
      </div>

      <section className="panel overflow-hidden" aria-labelledby="errors-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
          <h2 id="errors-title" className="text-sm font-bold text-ink">Recent errors</h2>
          <span className="text-xs text-ink-3">Server errors, render errors and scheduler problems · repeats within 10 min are counted, not listed · kept 14 days</span>
        </div>
        {o.events.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-3">No errors recorded in the last 14 days.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recent errors table">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-wash text-xs text-ink-3">
                <tr><th className="px-5 py-2 font-medium">Last seen</th><th className="px-3 py-2 font-medium">Where</th><th className="px-3 py-2 font-medium">What happened</th><th className="px-3 py-2 text-right font-medium">Times</th><th className="px-5 py-2 font-medium">Request id</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {o.events.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2.5 text-ink-2">{time(e.lastAt)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${e.level === "error" ? "bg-down-soft text-down" : "bg-amber-soft text-amber"}`}>{e.source}</span>
                    </td>
                    <td className="max-w-xl break-words px-3 py-2.5 text-ink">{e.message}{e.count > 1 && <span className="block text-xs text-ink-3">first {time(e.firstAt)}</span>}</td>
                    <td className="num px-3 py-2.5 text-right text-ink">{e.count}</td>
                    <td className="num px-5 py-2.5 text-xs text-ink-3">{e.requestId ? <span title="Search the server logs for this id">{e.requestId.slice(0, 8)}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
