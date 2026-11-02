"use client";

import { useState } from "react";
import type { ZoneDraft } from "@/lib/analyst/extract";
import { fmtPrice } from "@/lib/format";
import { ASSET_CATALOG } from "@/lib/market/catalog";
import { api, btn, btnQuiet, cell, deskRes, field, hint, KIND_LABEL, label, type ExtractResult, type PlanDto } from "./resources";

/** Prices stay text while typing ("1.1" passes through "1."). */
type Row = Omit<ZoneDraft, "low" | "high"> & { low: string; high: string; key: number; confirmed: boolean };
const KINDS = Object.keys(KIND_LABEL) as ZoneDraft["kind"][];
let nextKey = 1;

const offsetsFrom = (r: ExtractResult) => {
  const out: Record<string, string> = {};
  for (const s of new Set(r.draft.zones.map((z) => z.symbol))) {
    const ref = r.draft.refPrices[s];
    const feed = r.feed[s];
    out[s] = ref != null && feed != null ? String(Number((feed - ref).toFixed(4))) : "0";
  }
  return out;
};
/** ISO instant ↔ the value of a datetime-local input, in the viewer's own time zone. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => new Date(v).toISOString();

/**
 * Review step: everything the model read is editable, uncertain numbers must be confirmed one by one, and the
 * feed offset per symbol is shown next to the analyst's own price. Nothing is watched until "Save and activate".
 */
export function DraftEditor({ result, rawText, sources, channel, onDone }: { result: ExtractResult; rawText: string; sources: string[]; channel: string | null; onDone: () => void }) {
  const d = result.draft;
  const [source, setSource] = useState(d.source ?? "");
  const [title, setTitle] = useState(d.title ?? "");
  const [expiresAt, setExpiresAt] = useState(toLocalInput(d.expiresAt));
  const [events, setEvents] = useState(d.events.map((e) => ({ ...e, at: toLocalInput(e.at) })));
  const [offsets, setOffsets] = useState(() => offsetsFrom(result));
  const [rows, setRows] = useState<Row[]>(() => d.zones.map((z) => ({ ...z, low: String(z.low), high: String(z.high), key: nextKey++, confirmed: false })));
  const [postToChannel, setPostToChannel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const unconfirmed = rows.filter((r) => r.uncertain && !r.confirmed).length;
  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save(activate: boolean) {
    setBusy(true); setError(null);
    try {
      const { plan } = await api<{ plan: PlanDto }>("/api/analyst/plans", "POST", {
        source: source.trim(), title: title.trim() || null, rawText, expiresAt: fromLocalInput(expiresAt), postToChannel,
        events: events.filter((e) => e.label.trim() && e.at).map((e) => ({ at: fromLocalInput(e.at), label: e.label.trim() })),
        offsets: Object.fromEntries(symbols.map((s) => [s, Number(offsets[s] ?? 0) || 0])),
        zones: rows.map(({ key: _key, ...z }) => ({ ...z, low: Number(z.low), high: Number(z.high), direction: z.kind === "INVALIDATION" ? z.direction : null, closeTf: z.kind === "INVALIDATION" ? z.closeTf ?? "4H" : null })),
      });
      if (activate) await api(`/api/analyst/plans/${plan.id}`, "PATCH", { action: "activate" });
      await deskRes.load(true);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      await deskRes.load(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="draft-h" className="space-y-5 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="draft-h" className="font-display text-lg font-bold text-ink">Review the plan</h2>
        <p className="text-xs text-ink-3">Times are your local time. Nothing is watched until you activate.</p>
      </div>

      {d.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-soft p-3 text-sm text-amber">
          {d.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="ap-source" className={label}>Source</label>
          <input id="ap-source" className={field} list="ap-sources" value={source} onChange={(e) => setSource(e.target.value)} dir="auto" required />
          <datalist id="ap-sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <div>
          <label htmlFor="ap-title" className={label}>Title</label>
          <input id="ap-title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" />
        </div>
        <div>
          <label htmlFor="ap-exp" className={label}>Watch until</label>
          <input id="ap-exp" type="datetime-local" className={field} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
      </div>

      {symbols.length > 0 && (
        <div>
          <h3 className={label}>Price basis</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="text-left text-xs text-ink-3"><th className="py-1 font-semibold">Symbol</th><th className="font-semibold">Analyst price</th><th className="font-semibold">Our feed</th><th className="font-semibold">Offset (feed − analyst)</th></tr></thead>
              <tbody>
                {symbols.map((s) => {
                  const zeroOnFutures = result.futures.includes(s) && Number(offsets[s] ?? 0) === 0;
                  return (
                    <tr key={s} className="border-t border-line">
                      <td className="py-1.5 font-semibold text-ink">{s}</td>
                      <td className="tabular-nums text-ink-2">{d.refPrices[s] != null ? fmtPrice(d.refPrices[s]) : "—"}</td>
                      <td className="tabular-nums text-ink-2">{result.feed[s] != null ? fmtPrice(result.feed[s]!) : "unavailable"}</td>
                      <td className="py-1">
                        <input aria-label={`${s} offset`} inputMode="decimal" className={`${cell} w-28`} value={offsets[s] ?? "0"} onChange={(e) => setOffsets((o) => ({ ...o, [s]: e.target.value }))} />
                        {zeroOnFutures && <p className="mt-1 text-xs text-amber">Our {s} feed is a futures contract: set the gap to your broker&apos;s price.</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={hint}>
            Zones stay in the analyst&apos;s prices; the worker subtracts the offset from our feed before comparing. The suggested offset
            also contains any move since the analysis was written: set it to the gap between our feed and your broker&apos;s price right now.
          </p>
        </div>
      )}

      <div>
        <h3 className={label}>Zones</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="py-1 font-semibold">Symbol</th><th className="font-semibold">Kind</th><th className="font-semibold">Low</th><th className="font-semibold">High</th>
                <th className="font-semibold">Breaks if close</th><th className="font-semibold">Condition / note</th><th className="font-semibold">Check</th><th><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={`border-t border-line align-top ${r.uncertain && !r.confirmed ? "bg-amber-soft" : ""}`}>
                  <td className="py-1 pr-2">
                    <select aria-label="Symbol" className={`${cell} w-full min-w-[7rem] font-semibold`} value={r.symbol} onChange={(e) => set(r.key, { symbol: e.target.value })}>
                      {ASSET_CATALOG.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol}</option>)}
                    </select>
                  </td>
                  <td className="pr-2 py-1">
                    <select aria-label="Kind" className={`${cell} w-full min-w-[8.5rem]`} value={r.kind} onChange={(e) => set(r.key, { kind: e.target.value as Row["kind"], direction: e.target.value === "INVALIDATION" ? r.direction ?? "ABOVE" : null })}>
                      {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td className="pr-2 py-1"><input aria-label="Low" inputMode="decimal" className={`${cell} w-full min-w-[6rem]`} value={r.low} onChange={(e) => set(r.key, { low: e.target.value })} /></td>
                  <td className="pr-2 py-1"><input aria-label="High" inputMode="decimal" className={`${cell} w-full min-w-[6rem]`} value={r.high} onChange={(e) => set(r.key, { high: e.target.value })} /></td>
                  <td className="pr-2 py-1">
                    {r.kind === "INVALIDATION" ? (
                      <div className="flex gap-1">
                        <select aria-label="Direction" className={`${cell} min-w-[5.5rem]`} value={r.direction ?? "ABOVE"} onChange={(e) => set(r.key, { direction: e.target.value as "ABOVE" | "BELOW" })}>
                          <option value="ABOVE">above</option><option value="BELOW">below</option>
                        </select>
                        <select aria-label="Timeframe" className={`${cell} min-w-[4rem]`} value={r.closeTf ?? "4H"} onChange={(e) => set(r.key, { closeTf: e.target.value as Row["closeTf"] })}>
                          <option>1H</option><option>4H</option><option>1D</option>
                        </select>
                      </div>
                    ) : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="pr-2 py-1">
                    <input aria-label="Condition" dir="auto" className={`${cell} w-full min-w-[10rem]`} placeholder="Condition" value={r.condition ?? ""} onChange={(e) => set(r.key, { condition: e.target.value || null })} />
                    {r.note && <p dir="auto" className="mt-1 text-xs text-ink-3">{r.note}</p>}
                  </td>
                  <td className="pr-2 py-1.5">
                    {r.uncertain ? (
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-amber">
                        <input type="checkbox" checked={r.confirmed} onChange={(e) => set(r.key, { confirmed: e.target.checked })} /> Confirm
                      </label>
                    ) : <span className="text-xs text-ink-3">ok</span>}
                  </td>
                  <td className="py-1"><button type="button" className={btnQuiet} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="py-3 text-sm text-ink-3">No zones were read from the text. Add them by hand, or paste again.</p>}
        <button type="button" className={`${btnQuiet} mt-2`}
          onClick={() => setRows((rs) => [...rs, { symbol: rs.at(-1)?.symbol ?? "XAU/USD", kind: "BUY", low: "", high: "", direction: null, closeTf: null, condition: null, note: null, uncertain: false, confirmed: false, key: nextKey++ }])}>
          Add zone
        </button>
        <p className={hint}>Amber rows are numbers the source itself marked unclear, or that sit far from the market. Check each on the chart, fix it, then tick Confirm.</p>
      </div>

      <div>
        <h3 className={label}>Risk events</h3>
        <ul className="space-y-2">
          {events.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <input aria-label="Event time" type="datetime-local" className={`${cell} w-auto`} value={e.at} onChange={(x) => setEvents((es) => es.map((y, j) => (j === i ? { ...y, at: x.target.value } : y)))} />
              <input aria-label="Event" dir="auto" className={`${cell} w-48`} value={e.label} onChange={(x) => setEvents((es) => es.map((y, j) => (j === i ? { ...y, label: x.target.value } : y)))} />
              <button type="button" className={btnQuiet} onClick={() => setEvents((es) => es.filter((_, j) => j !== i))}>Remove</button>
            </li>
          ))}
        </ul>
        <button type="button" className={`${btnQuiet} mt-2`} onClick={() => setEvents((es) => [...es, { at: expiresAt.slice(0, 10) + "T12:30", label: "" }])}>Add event</button>
        <p className={hint}>A zone message within two hours of an event carries a news-risk line (NFP, CPI, FOMC, elections).</p>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <input type="checkbox" checked={postToChannel} disabled={!channel} onChange={(e) => setPostToChannel(e.target.checked)} />
          Also post these alerts to {channel ? `@${channel}` : "the Telegram channel"}
        </label>
        <p className={hint}>
          {channel
            ? "Each post says it is a level alert, not an entry signal; the source is not named. You can turn it off later on the plan."
            : "The channel bot is not configured (SIGNAL_BOT_TOKEN, SIGNAL_CHANNEL_ID)."}
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} disabled={busy || !source.trim() || unconfirmed > 0 || rows.length === 0} onClick={() => save(true)}>
          {busy ? "Saving…" : "Save and activate"}
        </button>
        <button type="button" className={btnQuiet} disabled={busy || !source.trim()} onClick={() => save(false)}>Save as draft</button>
        <button type="button" className={btnQuiet} disabled={busy} onClick={onDone}>Discard</button>
        {unconfirmed > 0 && <span className="text-xs font-semibold text-amber">{unconfirmed} zone{unconfirmed > 1 ? "s" : ""} to confirm before activating</span>}
      </div>
    </section>
  );
}
