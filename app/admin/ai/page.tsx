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
    <section className="rounded-xl border border-gray-800 overflow-hidden">
      <h3 className="bg-gray-900 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h3>
      <table className="w-full text-left text-sm">
        <thead className="text-gray-500"><tr><th className="p-2 font-medium"> </th><th className="p-2 font-medium text-right">Calls</th><th className="p-2 font-medium text-right">Errors</th><th className="p-2 font-medium text-right">Tokens</th><th className="p-2 font-medium text-right">Est. cost</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-gray-500">No usage yet.</td></tr>}
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-gray-800 tabular-nums">
              <td className="p-2 text-gray-200">{r.key}</td>
              <td className="p-2 text-right">{r.calls}</td>
              <td className={`p-2 text-right ${r.errors ? "text-amber-400" : "text-gray-500"}`}>{r.errors}</td>
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
        <h1 className="text-2xl font-bold">AI</h1>
        <p className="text-sm text-gray-400 mt-1">Default models, image model, per-user allowance, and the last 7 days of usage.</p>
      </div>

      <section className="grid gap-2 sm:grid-cols-4">
        {providers.map((p) => (
          <div key={p.id} className="rounded-lg border border-gray-800 p-3 text-sm">
            <p className="font-medium text-gray-200">{p.label}</p>
            <p className={p.configured ? "text-emerald-400 text-xs" : "text-gray-500 text-xs"}>{p.configured ? "Configured" : `Set ${p.envKey}`}</p>
          </div>
        ))}
      </section>

      <AiSettingsForm initial={settings} models={MODELS} providers={providers} />

      <section className="grid gap-3 sm:grid-cols-4 text-sm">
        {[["Calls", usage.total.calls.toLocaleString("en-US")], ["Errors", String(usage.total.errors)], ["Tokens", usage.total.tokens.toLocaleString("en-US")], ["Est. cost", usd(usage.total.costUsd)]].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-gray-800 p-3"><p className="text-xs text-gray-500">{k} · 7 days</p><p className="text-lg font-semibold tabular-nums">{v}</p></div>
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
