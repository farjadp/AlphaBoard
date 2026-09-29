import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { PROVIDERS } from "@/lib/news/sources";
import { readProviderStates } from "@/lib/news/ingest";
import { indexReport, publisherReport } from "@/lib/news/measure";
import { NEWS_LAST_KEY, type NewsJobResult } from "@/lib/news/job";
import { WEIGHT_LIMITS } from "@/lib/news/weights";
import type { Accuracy } from "@/lib/news/stats";
import { RevertButton, RunWeightsButton, WeightEditor } from "@/components/admin/news/NewsActions";

export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const signedPct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`);
const when = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—");
const th = "p-2 font-medium";
const Hit = ({ a }: { a: Accuracy }) => (
  <>
    <td className="p-2 text-right">{a.calls}<span className="text-ink-3"> / {a.articles}</span></td>
    <td className="p-2 text-right">{pct(a.hitRate4h)}</td>
    <td className="p-2 text-right">{pct(a.hitRate24h)}</td>
    <td className="p-2 text-right">{signedPct(a.avgSignedRet24hPct)}</td>
  </>
);

export default async function AdminNewsPage() {
  await requireAdmin();
  const now = new Date();
  const [states, lastRow, pubs, index, runs, changes, articles24h] = await Promise.all([
    readProviderStates(),
    prisma.appSetting.findUnique({ where: { key: NEWS_LAST_KEY } }),
    publisherReport(now, 30),
    indexReport(now, 30),
    prisma.newsWeightRun.findMany({ orderBy: { at: "desc" }, take: 8 }),
    prisma.publisherWeightChange.findMany({ orderBy: { createdAt: "desc" }, take: 40, include: { publisher: { select: { name: true } } } }),
    prisma.newsArticle.count({ where: { fetchedAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
  ]);
  const last = lastRow?.value as NewsJobResult | undefined;
  const latestChange = new Map<string, string>();
  for (const c of changes) if (!latestChange.has(c.publisherKey)) latestChange.set(c.publisherKey, c.id);
  const today = now.toISOString().slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-ink">News</h1>
        <p className="mt-1 text-sm text-ink-3">
          Sources, publisher credibility weights and the news index. {articles24h.toLocaleString("en-US")} new articles in the last 24 h
          {last ? ` · last pass ${when(last.at)}` : " · the news job has not run yet"}.
        </p>
      </div>

      <section className="panel overflow-x-auto">
        <h2 className="label-caps border-b border-line bg-wash px-3 py-2">Sources</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink-3"><tr><th className={th}>Provider</th><th className={`${th} text-right`}>Calls today</th><th className={th}>Last success</th><th className={`${th} text-right`}>Items</th><th className={th}>Last error</th></tr></thead>
          <tbody>
            {PROVIDERS.map((p) => {
              const s = states[p.id];
              const calls = s?.day === today ? s.count : 0;
              const errRecent = s?.lastErrorAt && (!s.lastOkAt || s.lastErrorAt >= s.lastOkAt);
              return (
                <tr key={p.id} className="border-t border-line text-ink-2">
                  <td className="p-2">
                    <span className="font-semibold text-ink">{p.label}</span>
                    {!p.enabled() && <span className="block text-xs text-ink-3">Off · set {p.envKey}</span>}
                  </td>
                  <td className="num p-2 text-right">{calls}{p.dailyBudget != null && <span className="text-ink-3"> / {p.dailyBudget}</span>}</td>
                  <td className="num p-2 text-xs">{when(s?.lastOkAt ?? null)}</td>
                  <td className="num p-2 text-right">{s?.lastOkAt ? s.lastItems : "—"}</td>
                  <td className={`p-2 text-xs ${errRecent ? "text-down" : "text-ink-3"}`}>{s?.lastError ? `${when(s.lastErrorAt)} · ${s.lastError}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">News index</h2>
          <p className="text-sm text-ink-3">
            Hourly weighted sentiment of the last 24 h per symbol, checked against the price 4 h and 24 h later.
            <strong className="font-semibold text-ink-2"> Recorded only — trading agents never see it</strong> until the evaluation justifies it.
          </p>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          {[["Evaluated snapshots (30 d)", String(index.overall.accuracy.articles)], ["Hit rate at 24 h", pct(index.overall.accuracy.hitRate24h)], ["Correlation with 24 h return", index.overall.correlation24h == null ? "—" : index.overall.correlation24h.toFixed(2)]].map(([k, v]) => (
            <div key={k} className="panel p-3"><p className="label-caps">{k}</p><p className="num text-lg font-semibold text-ink">{v}</p></div>
          ))}
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-3"><tr><th className={th}>Symbol</th><th className={`${th} text-right`}>Latest</th><th className={`${th} text-right`}>Articles</th><th className={`${th} text-right`}>Snapshots</th><th className={`${th} text-right`}>Calls / evaluated</th><th className={`${th} text-right`}>Hit 4 h</th><th className={`${th} text-right`}>Hit 24 h</th><th className={`${th} text-right`}>Avg move called way</th><th className={`${th} text-right`}>Corr. 24 h</th></tr></thead>
            <tbody className="num">
              {index.symbols.length === 0 && <tr><td colSpan={9} className="p-3 text-center font-sans text-ink-3">No snapshots yet — the first one is taken within an hour of the first articles.</td></tr>}
              {index.symbols.map((s) => (
                <tr key={s.symbol} className="border-t border-line text-ink-2">
                  <td className="p-2 font-sans font-semibold text-ink">{s.symbol}</td>
                  <td className={`p-2 text-right ${s.latest && s.latest.score > 0.15 ? "text-up" : s.latest && s.latest.score < -0.15 ? "text-down" : ""}`}>{s.latest ? s.latest.score.toFixed(2) : "—"}</td>
                  <td className="p-2 text-right">{s.latest?.articles ?? "—"}</td>
                  <td className="p-2 text-right">{s.snapshots}</td>
                  <Hit a={s.accuracy} />
                  <td className="p-2 text-right">{s.correlation24h == null ? "—" : s.correlation24h.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Publishers</h2>
          <p className="text-sm text-ink-3">
            Weight {WEIGHT_LIMITS.min}–{WEIGHT_LIMITS.max} scales how much a publisher counts. A call is a headline with a clear sentiment; hits are calls the price agreed with.
            All publishers start at 0.5. Baseline across all publishers: {pct(pubs.overall.hitRate24h)} at 24 h over {pubs.overall.calls} calls.
          </p>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-3"><tr><th className={th}>Publisher</th><th className={`${th} text-right`}>Weight</th><th className={`${th} text-right`}>Calls / evaluated (30 d)</th><th className={`${th} text-right`}>Hit 4 h</th><th className={`${th} text-right`}>Hit 24 h</th><th className={`${th} text-right`}>Avg move called way</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="num">
              {pubs.publishers.length === 0 && <tr><td colSpan={7} className="p-3 text-center font-sans text-ink-3">No publishers yet.</td></tr>}
              {pubs.publishers.slice(0, 60).map((p) => (
                <tr key={p.key} className={`border-t border-line ${p.window.calls >= WEIGHT_LIMITS.minCalls ? "text-ink-2" : "text-ink-3"}`}>
                  <td className="p-2 font-sans font-semibold text-ink">{p.name}</td>
                  <td className="p-2 text-right font-semibold text-ink">{p.weight.toFixed(2)}</td>
                  <Hit a={p.window} />
                  <td className="p-2 font-sans"><WeightEditor publisherKey={p.key} name={p.name} weight={p.weight} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {pubs.publishers.length > 60 && <p className="border-t border-line p-2 text-xs text-ink-3">Showing the 60 publishers with the most calls of {pubs.publishers.length}.</p>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Weights agent</h2>
            <p className="text-sm text-ink-3">
              Runs once a week. It proposes; the code applies at most ±{WEIGHT_LIMITS.weeklyStep} per week and only for publishers with ≥ {WEIGHT_LIMITS.minCalls} evaluated calls.
            </p>
          </div>
          <RunWeightsButton />
        </div>
        <ul className="space-y-2">
          {runs.length === 0 && <li className="panel p-3 text-sm text-ink-3">No runs yet.</li>}
          {runs.map((r) => (
            <li key={r.id} className="panel p-3 text-sm">
              <p className="flex flex-wrap gap-x-3 text-xs text-ink-3">
                <span className="num">{when(r.at)}</span>
                <span className={r.status === "ok" ? "font-semibold text-up" : r.status === "error" ? "font-semibold text-down" : "font-semibold text-ink-2"}>{r.status}</span>
                {r.model && <span>{r.model}</span>}
                {r.costUsd != null && <span className="num">${r.costUsd.toFixed(4)}</span>}
              </p>
              {(r.summary || r.error) && <p className="mt-1 text-ink-2">{r.summary ?? r.error}</p>}
              {Array.isArray(r.skipped) && r.skipped.length > 0 && (
                <p className="mt-1 text-xs text-ink-3">Refused by the code: {(r.skipped as Array<{ publisher: string; why: string }>).map((s) => `${s.publisher} (${s.why})`).join("; ")}</p>
              )}
            </li>
          ))}
        </ul>

        <div className="panel overflow-x-auto">
          <h3 className="label-caps border-b border-line bg-wash px-3 py-2">Change log</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-ink-3"><tr><th className={th}>When</th><th className={th}>Publisher</th><th className={`${th} text-right`}>Weight</th><th className={th}>By</th><th className={th}>Why</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {changes.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-ink-3">No changes yet.</td></tr>}
              {changes.map((c) => {
                const ev = c.evidence as { window30d?: Accuracy } | null;
                return (
                  <tr key={c.id} className={`border-t border-line align-top ${c.revertedAt ? "text-ink-3" : "text-ink-2"}`}>
                    <td className="num p-2 text-xs">{when(c.createdAt)}</td>
                    <td className="p-2 font-semibold text-ink">{c.publisher.name}</td>
                    <td className="num p-2 text-right">
                      {c.from.toFixed(2)} → {c.to.toFixed(2)}
                      {c.clamped && <span className="block text-xs text-amber" title="The code limits changed the agent's proposal">asked {c.proposed.toFixed(2)}</span>}
                    </td>
                    <td className="p-2 text-xs">{c.by === "agent" ? "Agent" : "Admin"}{c.revertedAt && <span className="block">reverted</span>}</td>
                    <td className="p-2">
                      {c.reason}
                      {ev?.window30d && <span className="num block text-xs text-ink-3">At the time: {ev.window30d.calls} calls, hit 24 h {pct(ev.window30d.hitRate24h)}, avg {signedPct(ev.window30d.avgSignedRet24hPct)}</span>}
                    </td>
                    <td className="p-2">{!c.revertedAt && !c.revertOfId && latestChange.get(c.publisherKey) === c.id && <RevertButton changeId={c.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
