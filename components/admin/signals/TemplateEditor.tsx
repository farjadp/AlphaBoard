"use client";

import { useRef, useState } from "react";
import { useResource } from "@/lib/client/resource";
import { formatSignalPost, templateProblems } from "@/lib/signalDesk/format";
import { btn, btnQuiet, field, hint, templateRes } from "./resources";

const SAMPLE = { symbol: "XAUUSD.ec", side: "BUY" as const, entry: 4077.5, stop: 4063, tps: [4100, 4130, 4135, 4154], riskPct: 0.5, note: "Above the 4H EMA" };

/** Admin → Signals: edit the channel post template with a live preview. */
export function TemplateEditor() {
  const { data, error } = useResource(templateRes);
  /** Unsaved edits; null shows the saved template. */
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  if (!data) return error ? <p role="alert" className="text-sm text-down">{error}</p> : null;
  const draft = edit ?? data.template;
  const setDraft = (t: string) => setEdit(t === data.template ? null : t);

  const problems = templateProblems(draft);
  const dirty = draft !== data.template;
  const preview = problems.length ? null : formatSignalPost(SAMPLE, draft, data.channel);

  function insert(name: string) {
    const el = box.current;
    const token = `{${name}}`;
    if (!el) return setDraft(draft + token);
    const start = el.selectionStart, end = el.selectionEnd;
    const next = draft.slice(0, start) + token + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  }

  async function call(method: "PUT" | "DELETE") {
    if (method === "DELETE" && !window.confirm("Go back to the built-in template? Your edits are removed.")) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/signal-desk/template", { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...(method === "PUT" ? { body: JSON.stringify({ template: draft }) } : {}) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
      await templateRes.load(true);
      setEdit(null);
      setMsg({ ok: true, text: method === "PUT" ? "Saved. New signals use this template." : "Back to the built-in template." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sd-template" className="panel space-y-4 p-5">
      <div>
        <h2 id="sd-template" className="font-display text-lg font-bold text-ink">Channel post template</h2>
        <p className="mt-1 text-sm text-ink-2">How a new signal looks in the channel. Fields in braces are filled per signal; a line whose fields are all empty is left out. Target, stop and close replies keep their own short format.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <label htmlFor="sd-template-text" className="sr-only">Template</label>
          <textarea id="sd-template-text" ref={box} dir="auto" className={`${field} min-h-72 font-sans leading-relaxed`} rows={14} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">Insert a field</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(data.fields).map(([name, about]) => (
                <button key={name} type="button" title={about} className="rounded-md border border-line px-2 py-1 font-mono text-xs text-ink-2 hover:bg-wash hover:text-ink" onClick={() => insert(name)}>{`{${name}}`}</button>
              ))}
            </div>
            <p className={hint}>Hover a field to see what it prints.{!data.channel && " {channel} is empty until SIGNAL_CHANNEL_USERNAME is set."}</p>
          </div>
          {problems.length > 0 && <ul className="space-y-1 text-sm text-down" aria-live="polite">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ink-2" : "text-down"}`}>{msg.text}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} disabled={busy || !dirty || problems.length > 0} onClick={() => call("PUT")}>{busy ? "Saving…" : "Save template"}</button>
            {dirty && <button type="button" className={btnQuiet} disabled={busy} onClick={() => setEdit(null)}>Undo changes</button>}
            {!data.isDefault && <button type="button" className={btnQuiet} disabled={busy} onClick={() => call("DELETE")}>Back to default</button>}
            {dirty && <span className="text-xs text-amber">Not saved yet</span>}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-ink-2">Preview with a sample gold signal</p>
          {preview
            ? <pre dir="auto" className="whitespace-pre-wrap rounded-lg bg-wash p-4 font-sans text-sm leading-relaxed text-ink">{preview}</pre>
            : <p className="rounded-lg bg-wash p-4 text-sm text-ink-3">Fix the template to see the preview.</p>}
        </div>
      </div>
    </section>
  );
}
