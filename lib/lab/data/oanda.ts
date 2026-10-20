import "server-only";
import type { ExchangeConnection } from "@prisma/client";
import { OANDA_HOSTS } from "@/lib/venues/oanda";
import { decryptSecret } from "@/lib/secrets/crypto";
import { makeBars, type Bars } from "../bars";
import { LabDataError } from "./encode";

/**
 * Strategy Lab — OANDA v20 candles over a range (read-only endpoint), with bid and ask so the spread is
 * the broker's real one: mid = (bid + ask) / 2 for o/h/l/c, spread = ask close − bid close. Only complete
 * candles are kept. Paged 5000 at a time.
 */
export type OandaGranularity = "M1" | "M15" | "H1";
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface OandaFetchDeps { fetch?: Fetch; sleep?: (ms: number) => Promise<void>; decrypt?: (enc: string) => string }

interface Candle { time: string; complete: boolean; bid?: Record<"o" | "h" | "l" | "c", string>; ask?: Record<"o" | "h" | "l" | "c", string> }

export async function fetchOandaHistory(
  q: { conn: Pick<ExchangeConnection, "sandbox" | "apiKeyEnc">; instrument: string; granularity: OandaGranularity; from: number; to: number },
  deps: OandaFetchDeps = {},
): Promise<{ bars: Bars; spread: Float64Array; from: number; to: number }> {
  const doFetch = deps.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const token = (deps.decrypt ?? decryptSecret)(q.conn.apiKeyEnc);
  const host = q.conn.sandbox ? OANDA_HOSTS.practice : OANDA_HOSTS.live;
  const rows: Array<[number, number, number, number, number]> = [];
  const spread: number[] = [];
  let from = q.from;
  let first = true;
  for (;;) {
    const params = new URLSearchParams({ price: "BA", granularity: q.granularity, from: (from / 1000).toFixed(3), count: "5000" });
    if (!first) params.set("includeFirst", "false");
    const url = `${host}/v3/instruments/${encodeURIComponent(q.instrument)}/candles?${params}`;
    let res: Response;
    try {
      res = await doFetch(url, { headers: { Authorization: `Bearer ${token}`, "Accept-Datetime-Format": "UNIX" }, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new LabDataError(`OANDA candles: network error (${e instanceof Error ? e.name : "unknown"})`);
    }
    const body = (await res.json().catch(() => null)) as { candles?: Candle[]; errorMessage?: string } | null;
    if (!res.ok || !body?.candles) throw new LabDataError(`OANDA candles for ${q.instrument}: ${body?.errorMessage ?? `HTTP ${res.status}`}`);
    let reachedNow = false;
    let lastT = from;
    for (const c of body.candles) {
      const t = Math.round(Number(c.time) * 1000);
      lastT = t;
      if (t > q.to) { reachedNow = true; break; }
      if (!c.complete) { reachedNow = true; break; }
      if (!c.bid || !c.ask) continue;
      if (rows.length && t <= rows[rows.length - 1][0]) continue;
      const mid = (k: "o" | "h" | "l" | "c") => (Number(c.bid![k]) + Number(c.ask![k])) / 2;
      rows.push([t, mid("o"), mid("h"), mid("l"), mid("c")]);
      spread.push(Number(c.ask.c) - Number(c.bid.c));
    }
    first = false;
    if (reachedNow || body.candles.length < 5000) break;
    from = lastT;
    await sleep(100);
  }
  if (!rows.length) throw new LabDataError(`OANDA has no complete ${q.granularity} candles for ${q.instrument} in that range`);
  return { bars: makeBars(rows), spread: Float64Array.from(spread), from: rows[0][0], to: rows[rows.length - 1][0] };
}
