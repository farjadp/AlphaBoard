"use client";

import { useEffect, useState } from "react";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";

type Status = { configured: boolean; linked: boolean; pendingCode: string | null; botUsername: string | null; deepLink: string | null };
const status = createResource<Status | null>("/api/settings/telegram", { fallback: null, select: (j) => j as Status });

/** Optional Telegram delivery of alerts: one-time code → `/start CODE` to the bot → linked on the next tick. */
export default function TelegramSettings() {
  const { data, error } = useResource(status);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // While a code is pending, re-check until the tick (≤ 1 minute) links the chat.
  useEffect(() => {
    if (!data?.pendingCode) return;
    const t = setInterval(() => void status.load(true), 5_000);
    return () => clearInterval(t);
  }, [data?.pendingCode]);

  const act = async (method: "POST" | "DELETE") => {
    setBusy(true); setActionError(null);
    try {
      await status.mutate<Status>({ request: jsonRequest("/api/settings/telegram", method), apply: (_d, b) => b });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const btn = "rounded-lg border border-line-2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash disabled:opacity-50";

  return (
    <section className="space-y-3 panel p-5" aria-labelledby="tg-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="tg-title" className="text-sm font-semibold text-ink">Telegram alerts</h2>
        {data && <span className={`text-xs ${data.linked ? "text-up" : "text-ink-3"}`}>{data.linked ? "Linked" : data.configured ? "Not linked" : "Not available"}</span>}
      </div>
      {!data ? (
        <p className="text-xs text-ink-3">{error ?? "Loading…"}</p>
      ) : !data.configured ? (
        <p className="text-xs text-ink-3">Telegram delivery is not configured on this server (an administrator sets <code>TELEGRAM_BOT_TOKEN</code>). Alerts still arrive in the in-app notification bell.</p>
      ) : data.linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-3">Price alerts and paper stop/target closes are also sent to your Telegram chat.</p>
          <button type="button" className={btn} disabled={busy} onClick={() => act("DELETE")}>Unlink</button>
        </div>
      ) : data.pendingCode ? (
        <div className="space-y-2 text-xs text-ink-2">
          <p>
            Send this message to {data.botUsername ? <span className="font-medium text-ink">@{data.botUsername}</span> : "the bot"} within 15 minutes:
          </p>
          <p className="select-all rounded-lg bg-wash px-3 py-2 font-mono text-sm text-ink">/start {data.pendingCode}</p>
          <div className="flex flex-wrap items-center gap-3">
            {data.deepLink && <a href={data.deepLink} target="_blank" rel="noopener noreferrer" className={btn}>Open in Telegram</a>}
            <span className="text-ink-3">Waiting for the bot… this page updates by itself (up to a minute).</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-3">Get price alerts and paper stop/target closes on Telegram as well as in the app.</p>
          <button type="button" className={btn} disabled={busy} onClick={() => act("POST")}>Link Telegram</button>
        </div>
      )}
      {actionError && <p role="alert" className="text-xs text-red-300">{actionError}</p>}
    </section>
  );
}
