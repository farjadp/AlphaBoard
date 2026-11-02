"use client";

import { useEffect, useState } from "react";
import { useResource } from "@/lib/client/resource";
import { DraftEditor } from "./DraftEditor";
import { PlanList } from "./PlanList";
import { Scorecard } from "./Scorecard";
import { api, btn, deskRes, field, hint, label, type ExtractResult } from "./resources";

const REFRESH_MS = 30_000;

/** `channel` = the signals channel username when the channel bot is configured, else null. */
export default function AnalystDesk({ channel }: { channel: string | null }) {
  const desk = useResource(deskRes);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ result: ExtractResult; text: string } | null>(null);

  useEffect(() => {
    const t = setInterval(() => void deskRes.load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const sources = [...new Set(desk.data.plans.map((p) => p.source))];

  async function extract() {
    setBusy(true); setError(null);
    try {
      setDraft({ result: await api<ExtractResult>("/api/analyst/extract", "POST", { text }), text });
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {draft ? (
        <DraftEditor result={draft.result} rawText={draft.text} sources={sources} channel={channel} onDone={() => setDraft(null)} />
      ) : (
        <section aria-labelledby="paste-h" className="space-y-2 rounded-lg bg-wash p-4">
          <h2 id="paste-h" className="sr-only">Paste an analysis</h2>
          <label htmlFor="ap-text" className={label}>Paste an analysis</label>
          <textarea id="ap-text" dir="auto" className={`${field} min-h-40`} rows={8} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="A weekly video summary, a channel post or your own notes: levels, zones, targets and what cancels the scenario." />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btn} disabled={busy || text.trim().length < 20} onClick={extract}>{busy ? "Reading…" : "Read the zones"}</button>
            <span className={hint}>AI lists the zones for you to check. Nothing is watched until you activate the plan.</span>
          </div>
          {error && <p role="alert" className="text-sm text-down">{error}</p>}
        </section>
      )}
      <PlanList plans={desk.data.plans} loaded={desk.loaded} error={desk.error} channel={channel} />
      <Scorecard scores={desk.data.scores} />
    </div>
  );
}
