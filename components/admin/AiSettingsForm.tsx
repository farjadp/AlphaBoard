"use client";

import { useState } from "react";

type Settings = { provider: string; model: string; visionProvider: string; visionModel: string; defaultDailyTokenQuota: number };
type Model = { provider: string; id: string; label: string; vision: boolean };
type Provider = { id: string; label: string; envKey: string; configured: boolean };

export default function AiSettingsForm({ initial, models, providers }: { initial: Settings; models: Model[]; providers: Provider[] }) {
  const [s, setS] = useState(initial);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; msg?: string }>({ kind: "idle" });
  const ok = (p: string) => providers.find((x) => x.id === p)?.configured;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    const res = await fetch("/api/admin/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
    const body = await res.json().catch(() => ({}));
    setStatus(res.ok ? { kind: "saved" } : { kind: "error", msg: body.error ?? "Save failed" });
  }

  const option = (m: Model) => (
    <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>
      {m.label}{ok(m.provider) ? "" : " (key missing)"}
    </option>
  );
  const select = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

  return (
    <form onSubmit={save} className="panel space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="label-caps block">Default model</span>
          <select className={select} value={`${s.provider}::${s.model}`} onChange={(e) => { const [provider, model] = e.target.value.split("::"); setS({ ...s, provider, model }); }}>
            {models.map(option)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="label-caps block">Model for images (screenshots, charts)</span>
          <select className={select} value={`${s.visionProvider}::${s.visionModel}`} onChange={(e) => { const [visionProvider, visionModel] = e.target.value.split("::"); setS({ ...s, visionProvider, visionModel }); }}>
            {models.filter((m) => m.vision).map(option)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="label-caps block">Daily token allowance for new users</span>
          <input type="number" min={1} max={50_000_000} step={1} className={select} value={s.defaultDailyTokenQuota}
            onChange={(e) => setS({ ...s, defaultDailyTokenQuota: Number(e.target.value) })} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={status.kind === "saving"} className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-paper hover:bg-ink-hover disabled:opacity-50">
          {status.kind === "saving" ? "Saving…" : "Save"}
        </button>
        {status.kind === "saved" && <span className="text-sm font-semibold text-up">Saved</span>}
        {status.kind === "error" && <span role="alert" className="text-sm text-down">{status.msg}</span>}
      </div>
    </form>
  );
}
