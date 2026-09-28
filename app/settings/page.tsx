"use client";

import { useState } from "react";
import NavBar from "@/components/NavBar";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";

type ModelRow = { provider: string; id: string; label: string; vision: boolean; priceInPerM: number; priceOutPerM: number };
type View = {
  providers: Array<{ id: string; label: string; configured: boolean }>;
  models: ModelRow[];
  preference: { provider: string; model: string } | null;
  defaults: { provider: string; model: string; label: string };
  effective: { provider: string; model: string; label: string } | null;
  vision: { provider: string; model: string; label: string } | null;
  usage: { tokens: number; costUsd: number; calls: number; quota: number; resetsAt: string };
};

const settingsResource = createResource<View | null>("/api/settings/ai", { fallback: null, select: (j) => j as View });
const fmt = (n: number) => n.toLocaleString("en-US");

export default function SettingsPage() {
  const { data, error } = useResource(settingsResource);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function choose(value: string) {
    const [provider, model] = value === "default" ? [null, null] : value.split("::");
    setSaving(true);
    setSaveError(null);
    try {
      await settingsResource.mutate<View>({ request: jsonRequest("/api/settings/ai", "PUT", { provider, model }), apply: (_d, body) => body });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const current = data?.preference ? `${data.preference.provider}::${data.preference.model}` : "default";
  const pct = data ? Math.min(100, Math.round((data.usage.tokens / Math.max(1, data.usage.quota)) * 100)) : 0;
  const chosen = data?.models.find((m) => `${m.provider}::${m.id}` === current);

  return (
    <div className="min-h-screen bg-page">
      <NavBar />
      <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <header>
          <h1 className="font-display text-2xl font-extrabold text-ink">Settings</h1>
          <p className="mt-1 text-sm text-ink-3">Choose the AI model used for your strategy reports, post-mortems and chart studies.</p>
        </header>

        {!data ? (
          <p className="text-sm text-ink-3">{error ?? "Loading…"}</p>
        ) : (
          <>
            <section className="panel space-y-4 p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-bold text-ink">AI model</h2>
                <span className="text-xs text-ink-3">In use: <span className="font-semibold text-ink">{data.effective?.label ?? "none configured"}</span></span>
              </div>
              <label htmlFor="model" className="sr-only">AI model</label>
              <select id="model" value={current} disabled={saving} onChange={(e) => choose(e.target.value)}
                className="w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-60">
                <option value="default">Workspace default ({data.defaults.label})</option>
                {data.providers.map((p) => (
                  <optgroup key={p.id} label={p.configured ? p.label : `${p.label} (not configured on this server)`}>
                    {data.models.filter((m) => m.provider === p.id).map((m) => (
                      <option key={m.id} value={`${m.provider}::${m.id}`} disabled={!p.configured}>
                        {m.label} · ${m.priceInPerM}/${m.priceOutPerM} per 1M tokens{m.vision ? "" : " · no images"}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {chosen && !chosen.vision && data.vision && (
                <p className="rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber">This model cannot read images, so screenshot reading and chart studies will use {data.vision.label}.</p>
              )}
              {saveError && <p role="alert" className="text-xs text-down">{saveError}</p>}
              <p className="text-xs text-ink-3">Prices are list prices per million input/output tokens, used to estimate cost. Reasoning models also bill their hidden reasoning tokens.</p>
            </section>

            <section className="panel space-y-3 p-5">
              <h2 className="text-sm font-bold text-ink">Today&apos;s AI usage</h2>
              <div className="num flex justify-between text-sm text-ink-2">
                <span>{fmt(data.usage.tokens)} / {fmt(data.usage.quota)} tokens</span>
                <span>≈ ${data.usage.costUsd.toFixed(3)} · {data.usage.calls} call{data.usage.calls === 1 ? "" : "s"}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-wash" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Daily AI allowance used">
                <div className={`h-full ${pct >= 90 ? "bg-down" : pct >= 70 ? "bg-amber" : "bg-up"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-ink-3">Resets at {new Date(data.usage.resetsAt).toLocaleString()} (00:00 UTC). Ask an administrator if you need a higher limit.</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
