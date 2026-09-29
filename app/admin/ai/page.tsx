import { requireAdmin } from "@/lib/auth/dal";
import { MODELS, PROVIDERS } from "@/lib/ai/catalog";
import { configuredProviders } from "@/lib/ai/configured";
import { getAiSettings } from "@/lib/ai/settings";
import { adminUsageSummary } from "@/lib/ai/usageReport";
import AiSettingsForm from "@/components/admin/AiSettingsForm";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

export default async function AdminAiPage() {
  await requireAdmin();
  const [settings, usage] = await Promise.all([getAiSettings(), adminUsageSummary(7)]);
  const configured = configuredProviders();
  const providers = Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, envKey: p.envKey, configured: configured.has(id as never) }));

  const table = (title: string, rows: typeof usage.byUser) => (
    <section className="panel overflow-hidden">
      <h2 className="label-caps border-b border-line bg-wash px-3 py-2">{title}</h2>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-ink-3"><tr><th className="p-2 font-medium"><span className="sr-only">{title}</span></th><th className="p-2 font-medium text-right">Calls</th><th className="p-2 font-medium text-right">Errors</th><th className="p-2 font-medium text-right" title="Refused by the requested model and answered by a server-side fallback">Fallbacks</th><th className="p-2 font-medium text-right">Tokens</th><th className="p-2 font-medium text-right">Est. cost</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-ink-3">No usage yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.key} className="num border-t border-line text-ink-2">
              <td className="p-2 font-sans text-ink">{r.key}</td>
              <td className="p-2 text-right">{r.calls}</td>
              <td className={`p-2 text-right ${r.errors ? "text-amber" : "text-ink-3"}`}>{r.errors}</td>
              <td className={`p-2 text-right ${r.fallbacks ? "text-accent" : "text-ink-3"}`}>{r.fallbacks}</td>
              <td className="p-2 text-right">{r.tokens.toLocaleString("en-US")}</td>
              <td className="p-2 text-right">{usd(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-ink">AI</h1>
        <p className="mt-1 text-sm text-ink-3">Default models, image model, per-user allowance, and the last 7 days of usage.</p>
      </div>

      <section className="grid gap-2 sm:grid-cols-4">
        {providers.map((p) => (
          <div key={p.id} className="panel p-3 text-sm">
            <p className="font-semibold text-ink">{p.label}</p>
            <p className={p.configured ? "text-xs font-semibold text-up" : "text-xs text-ink-3"}>{p.configured ? "Configured" : `Set ${p.envKey}`}</p>
          </div>
        ))}
      </section>

      <AiSettingsForm initial={settings} models={MODELS} providers={providers} />

      <section className="grid gap-3 sm:grid-cols-5 text-sm">
        {[["Calls", usage.total.calls.toLocaleString("en-US")], ["Errors", String(usage.total.errors)], ["Fallbacks", String(usage.total.fallbacks)], ["Tokens", usage.total.tokens.toLocaleString("en-US")], ["Est. cost", usd(usage.total.costUsd)]].map(([k, v]) => (
          <div key={k} className="panel p-3"><p className="label-caps">{k} · 7 days</p><p className="num text-lg font-semibold text-ink">{v}</p></div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {table("By user", usage.byUser)}
        {table("By model", usage.byModel)}
        {table("By feature", usage.byFeature)}
        {table("By day (UTC)", usage.byDay)}
      </div>
    </div>
  );
}
