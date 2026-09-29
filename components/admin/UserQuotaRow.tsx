"use client";

import { useState } from "react";

export default function UserQuotaRow({ id, quota }: { id: string; quota: number }) {
  const [value, setValue] = useState(String(quota));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    setState("saving");
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyTokenQuota: Number(value) }),
    });
    setState(res.ok ? "saved" : "error");
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`q-${id}`}>Daily token allowance</label>
      <input id={`q-${id}`} type="number" min={0} step={1000} value={value} onChange={(e) => { setValue(e.target.value); setState("idle"); }}
        className="num w-32 rounded-lg border border-line bg-paper px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none" />
      <button type="button" onClick={save} disabled={state === "saving" || value === String(quota) && state !== "error"}
        className="rounded-lg border border-line-2 px-2 py-1 text-xs font-bold text-ink hover:bg-wash disabled:opacity-40">
        {state === "saving" ? "…" : "Save"}
      </button>
      {state === "saved" && <span className="text-xs font-semibold text-up">Saved</span>}
      {state === "error" && <span className="text-xs text-down">Failed</span>}
    </div>
  );
}
