"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type State = "idle" | "busy" | "error";

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.error ?? `Failed (${res.status})`;
}

/** Weight + reason → admin override. */
export function WeightEditor({ publisherKey, name, weight }: { publisherKey: string; name: string; weight: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(weight.toFixed(2));
  const [reason, setReason] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-6 items-center text-xs font-semibold text-accent hover:underline" aria-label={`Change weight of ${name}`}>
        Change
      </button>
    );
  }

  async function save() {
    setState("busy");
    const err = await send(`/api/admin/news/publishers/${encodeURIComponent(publisherKey)}`, "PATCH", { weight: Number(value), reason });
    if (err) { setError(err); setState("error"); return; }
    setOpen(false); setState("idle"); setReason(""); router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`w-${publisherKey}`}>New weight for {name}</label>
      <input id={`w-${publisherKey}`} type="number" min={0.1} max={1} step={0.05} value={value} onChange={(e) => setValue(e.target.value)}
        className="num w-20 rounded-lg border border-line bg-paper px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none" />
      <label className="sr-only" htmlFor={`r-${publisherKey}`}>Reason</label>
      <input id={`r-${publisherKey}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (logged)" maxLength={500}
        className="w-48 rounded-lg border border-line bg-paper px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none" />
      <button type="button" onClick={save} disabled={state === "busy" || reason.trim().length < 3}
        className="rounded-lg bg-ink px-2.5 py-1 text-xs font-bold text-paper hover:bg-ink-hover disabled:opacity-40">{state === "busy" ? "Saving…" : "Save"}</button>
      <button type="button" onClick={() => { setOpen(false); setError(null); }} className="text-xs font-semibold text-ink-3 hover:text-ink">Cancel</button>
      {error && <span role="alert" className="w-full text-xs text-down">{error}</span>}
    </div>
  );
}

export function RevertButton({ changeId }: { changeId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={state === "busy"} onClick={async () => {
        setState("busy");
        const err = await send(`/api/admin/news/changes/${changeId}/revert`, "POST");
        if (err) { setError(err); setState("error"); return; }
        setState("idle"); router.refresh();
      }} className="inline-flex min-h-6 items-center text-xs font-semibold text-accent hover:underline disabled:opacity-40">
        {state === "busy" ? "Reverting…" : "Revert"}
      </button>
      {error && <span role="alert" className="text-xs text-down">{error}</span>}
    </span>
  );
}

export function RunWeightsButton() {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <button type="button" disabled={state === "busy"} onClick={async () => {
        setState("busy");
        const err = await send("/api/admin/news/weights", "POST");
        if (err) { setError(err); setState("error"); return; }
        setState("idle"); router.refresh();
      }} className="rounded-lg border border-line-2 px-3 py-1.5 text-xs font-bold text-ink hover:bg-wash disabled:opacity-40">
        {state === "busy" ? "Running…" : "Run agent now"}
      </button>
      {error && <span role="alert" className="text-xs text-down">{error}</span>}
    </div>
  );
}
