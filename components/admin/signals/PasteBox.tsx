"use client";

import { useState } from "react";
import { compressImage } from "@/lib/client/image";
import type { SignalDraft } from "@/lib/signals/importDraft";
import { btnQuiet, field, hint, label } from "./resources";

/** Paste text or a screenshot of someone's signal; the model fills the form below. Nothing is sent from here. */
export function PasteBox({ onDraft }: { onDraft: (draft: SignalDraft, warnings: string[]) => void }) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function takeFile(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    try { setImage(await compressImage(file)); } catch (e) { setError(e instanceof Error ? e.message : "Could not read the image"); }
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (!item) return; // plain text pastes into the box as usual
    e.preventDefault();
    void takeFile(item.getAsFile());
  }

  async function read() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/signal-desk/import", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(text.trim() ? { text } : {}), ...(image ? { image } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Request failed (HTTP ${res.status})`);
      onDraft(body.draft as SignalDraft, body.warnings as string[]);
      setText(""); setImage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg bg-wash p-4" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void takeFile(e.dataTransfer.files[0]); }}>
      <label htmlFor="sd-paste" className={label}>Paste a signal</label>
      <textarea id="sd-paste" className={`${field} min-h-20`} rows={3} value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste}
        placeholder="Paste the post's text here, or paste / drop a screenshot" />
      {image && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL preview */}
          <img src={image} alt="Pasted screenshot" className="h-16 w-auto rounded border border-line" />
          <button type="button" className={btnQuiet} onClick={() => setImage(null)}>Remove</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnQuiet} disabled={busy || (!text.trim() && !image)} onClick={read}>{busy ? "Reading…" : "Read and fill the form"}</button>
        <label className="cursor-pointer text-xs font-semibold text-ink-2 hover:text-ink">
          or choose a screenshot
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void takeFile(e.target.files?.[0])} />
        </label>
      </div>
      <p className={hint}>AI reads it into the form below. Nothing is sent until you check it and press Send.</p>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
    </div>
  );
}
