"use client";

import { useState } from "react";
import { createResource, jsonRequest, useResource } from "@/lib/client/resource";

export type ConnectionRow = {
  id: string; provider: "ccxt" | "oanda"; accountId: string | null; exchange: string; label: string; marketType: "spot" | "swap"; quote: string; sandbox: boolean;
  keyLast4: string; status: string; lastCheckedAt: string | null; lastError: string | null; createdAt: string;
};
export type ExchangesView = { enabled: boolean; allowed: boolean; reason: string | null; popular: string[]; connections: ConnectionRow[] };

export const exchangesResource = createResource<ExchangesView | null>("/api/exchanges", { fallback: null, select: (j) => j as ExchangesView });

const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
const label = "block text-xs font-medium text-ink-2";
const btn = "rounded-lg border border-line-2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash disabled:opacity-50";

function AddForm({ popular, onDone }: { popular: string[]; onDone: () => void }) {
  const [provider, setProvider] = useState<"ccxt" | "oanda">("ccxt");
  const [accountId, setAccountId] = useState("");
  const [exchange, setExchange] = useState("binance");
  const [name, setName] = useState("");
  const [marketType, setMarketType] = useState<"spot" | "swap">("spot");
  const [quote, setQuote] = useState("USDT");
  const [sandbox, setSandbox] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-wash p-4 sm:grid-cols-2"
      autoComplete="off"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null);
        try {
          const created = await exchangesResource.mutate<ConnectionRow>({
            request: jsonRequest("/api/exchanges", "POST", provider === "oanda"
              ? { provider, exchange: "oanda", accountId, label: name || null, marketType: "swap", quote, sandbox, apiKey, secret: "" }
              : { provider, exchange, label: name || null, marketType, quote, sandbox, apiKey, secret, password: password || null }),
            apply: (d, row) => (d ? { ...d, connections: [...d.connections, row] } : d),
          });
          // Check the keys right away so the connection is usable (or the reason is visible).
          await exchangesResource.mutate<{ connection: ConnectionRow }>({
            request: jsonRequest(`/api/exchanges/${created.id}/test`, "POST"),
            apply: (d, r) => (d ? { ...d, connections: d.connections.map((c) => (c.id === r.connection.id ? r.connection : c)) } : d),
          });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save the connection");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="sm:col-span-2">
        <p className={label} id="ex-provider-label">Broker</p>
        <div role="radiogroup" aria-labelledby="ex-provider-label" className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-paper p-1">
          {([["ccxt", "Crypto exchange"], ["oanda", "OANDA · forex, gold, silver"]] as const).map(([v, t]) => (
            <button key={v} type="button" role="radio" aria-checked={provider === v}
              onClick={() => { setProvider(v); setQuote(v === "oanda" ? "USD" : "USDT"); }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${provider === v ? "bg-ink text-paper" : "text-ink-3"}`}>{t}</button>
          ))}
        </div>
      </div>
      {provider === "ccxt" ? (
        <>
          <div>
            <label htmlFor="ex-exchange" className={label}>Exchange (ccxt id)</label>
            <input id="ex-exchange" list="ex-popular" className={`${field} mt-1`} value={exchange} onChange={(e) => setExchange(e.target.value.trim().toLowerCase())} required />
            <datalist id="ex-popular">{popular.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div>
            <label htmlFor="ex-label" className={label}>Name <span className="text-ink-3">(optional)</span></label>
            <input id="ex-label" className={`${field} mt-1`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Binance testnet" />
          </div>
          <div>
            <label htmlFor="ex-type" className={label}>Market</label>
            <select id="ex-type" className={`${field} mt-1`} value={marketType} onChange={(e) => setMarketType(e.target.value as "spot" | "swap")}>
              <option value="spot">Spot</option>
              <option value="swap">Perpetual futures</option>
            </select>
          </div>
          <div>
            <label htmlFor="ex-quote" className={label}>Quote currency</label>
            <input id="ex-quote" className={`${field} mt-1 uppercase`} value={quote} onChange={(e) => setQuote(e.target.value.toUpperCase())} required />
            <p className="mt-1 text-[11px] text-ink-3">BTC/USDT in the app trades BTC/{quote || "…"} here.</p>
          </div>
          <div className="sm:col-span-2 flex items-start gap-2">
            <input id="ex-sandbox" type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} className="mt-1 size-4 accent-accent" />
            <label htmlFor="ex-sandbox" className="text-sm text-ink-2">Testnet / sandbox<span className="block text-[11px] text-ink-3">Untick only for real money. Real-money sessions ask you to type LIVE.</span></label>
          </div>
          <div>
            <label htmlFor="ex-key" className={label}>API key</label>
            <input id="ex-key" className={`${field} mt-1 font-mono`} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} required />
          </div>
          <div>
            <label htmlFor="ex-secret" className={label}>API secret</label>
            <input id="ex-secret" type="password" className={`${field} mt-1 font-mono`} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" required />
          </div>
          <div>
            <label htmlFor="ex-pass" className={label}>Passphrase <span className="text-ink-3">(OKX, KuCoin, Bitget…)</span></label>
            <input id="ex-pass" type="password" className={`${field} mt-1 font-mono`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
        </>
      ) : (
        <>
          <div>
            <label htmlFor="oa-env" className={label}>Environment</label>
            <select id="oa-env" className={`${field} mt-1`} value={sandbox ? "practice" : "live"} onChange={(e) => setSandbox(e.target.value === "practice")}>
              <option value="practice">Practice (demo money)</option>
              <option value="live">Live (real money)</option>
            </select>
          </div>
          <div>
            <label htmlFor="oa-account" className={label}>v20 account ID</label>
            <input id="oa-account" className={`${field} mt-1 font-mono`} value={accountId} onChange={(e) => setAccountId(e.target.value.trim())} placeholder="101-001-1234567-001" required />
          </div>
          <div>
            <label htmlFor="oa-token" className={label}>API token</label>
            <input id="oa-token" type="password" className={`${field} mt-1 font-mono`} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" required />
            <p className="mt-1 text-[11px] text-ink-3">hub.oanda.com → Tools → API → Generate. Practice and live tokens differ.</p>
          </div>
          <div>
            <label htmlFor="oa-ccy" className={label}>Account currency</label>
            <input id="oa-ccy" className={`${field} mt-1 uppercase`} value={quote} onChange={(e) => setQuote(e.target.value.toUpperCase())} required />
            <p className="mt-1 text-[11px] text-ink-3">Sessions trade instruments quoted in it (XAU/USD, EUR/USD on a USD account).</p>
          </div>
          <div>
            <label htmlFor="oa-label" className={label}>Name <span className="text-ink-3">(optional)</span></label>
            <input id="oa-label" className={`${field} mt-1`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. OANDA practice" />
          </div>
        </>
      )}
      <div className="sm:col-span-2 rounded-lg bg-amber-soft p-3 text-xs text-amber">
        {provider === "oanda"
          ? <>Use a plain v20 account (not MT4-linked). The token is encrypted on the server; only its last four characters are ever shown.</>
          : <>Create the key with <strong>trading only</strong> — no withdrawals — and an IP allowlist if the exchange offers one. Keys are encrypted on the server; only the last four characters are ever shown.</>}
      </div>
      {error && <p role="alert" className="sm:col-span-2 text-xs text-down">{error}</p>}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button type="button" className={btn} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={busy} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:bg-ink-hover disabled:opacity-60">{busy ? "Saving and testing…" : "Save and test"}</button>
      </div>
    </form>
  );
}

/** Exchange connections for exchange sessions (owner only, with LIVE_TRADING_ENABLED). */
export default function ExchangeSettings() {
  const { data, error } = useResource(exchangesResource);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (id: string, kind: "test" | "delete") => {
    setBusy(id); setActionError(null);
    try {
      if (kind === "test") {
        await exchangesResource.mutate<{ connection: ConnectionRow }>({
          request: jsonRequest(`/api/exchanges/${id}/test`, "POST"),
          apply: (d, r) => (d ? { ...d, connections: d.connections.map((c) => (c.id === id ? r.connection : c)) } : d),
        });
      } else {
        await exchangesResource.mutate({ request: jsonRequest(`/api/exchanges/${id}`, "DELETE"), apply: (d) => (d ? { ...d, connections: d.connections.filter((c) => c.id !== id) } : d) });
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel space-y-3 p-5" aria-labelledby="ex-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ex-title" className="text-sm font-semibold text-ink">Exchange connections</h2>
        {data?.allowed && !adding && <button type="button" className={btn} onClick={() => setAdding(true)}>Add connection</button>}
      </div>
      <p className="text-xs text-ink-3">For agent sessions that place real orders — on an exchange testnet first, then with money you can afford to lose. AlphaBoard is not financial advice; you carry the risk.</p>
      {error && <p role="alert" className="text-xs text-down">{error}</p>}
      {data && !data.allowed && <p className="rounded-lg bg-wash p-3 text-xs text-ink-2">Not available: {data.reason}.</p>}
      {actionError && <p role="alert" className="text-xs text-down">{actionError}</p>}
      {data?.allowed && adding && <AddForm popular={data.popular} onDone={() => setAdding(false)} />}
      {data?.allowed && (
        data.connections.length ? (
          <ul className="divide-y divide-line">
            {data.connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {c.label}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${c.sandbox ? "bg-accent-soft text-accent" : "bg-down-soft text-down"}`}>{c.sandbox ? (c.provider === "oanda" ? "PRACTICE" : "TESTNET") : "REAL MONEY"}</span>
                  </p>
                  <p className="text-xs text-ink-3">{c.provider === "oanda" ? `OANDA · account ${c.accountId} · ${c.quote}` : `${c.exchange} · ${c.marketType === "swap" ? "perpetual" : "spot"} · ${c.quote}`} · key …{c.keyLast4}</p>
                  <p className={`text-xs ${c.status === "OK" ? "text-up" : c.status === "ERROR" ? "text-down" : "text-ink-3"}`}>
                    {c.status === "OK" ? "Keys work" : c.status === "ERROR" ? `Error: ${c.lastError}` : "Not tested yet"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={btn} disabled={busy === c.id} onClick={() => void act(c.id, "test")}>{busy === c.id ? "Testing…" : "Test"}</button>
                  <button type="button" className={`${btn} text-down`} disabled={busy === c.id} onClick={() => window.confirm(`Delete ${c.label}? The stored keys are wiped.`) && void act(c.id, "delete")}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        ) : !adding && <p className="text-xs text-ink-3">No connection yet. For a first run: log in at testnet.binance.vision with GitHub, create an HMAC key, and add it here as binance · spot · USDT · testnet.</p>
      )}
    </section>
  );
}
