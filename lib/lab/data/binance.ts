import { BINANCE_HOSTS } from "@/lib/market/http";
import "server-only";
import { makeBars, type Bars } from "../bars";
import { LabDataError } from "./encode";

/**
 * Strategy Lab — Binance spot klines over a range, paged 1000 at a time. data-api.binance.vision serves
 * public market data without the geo-blocks of api.binance.com from US cloud regions.
 */
const HOSTS = BINANCE_HOSTS;
const STEP: Record<string, number> = { "1m": 60_000, "15m": 900_000, "1h": 3_600_000 };
export type BinanceInterval = keyof typeof STEP;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface FetchDeps { fetch?: Fetch; sleep?: (ms: number) => Promise<void> }

export async function fetchBinanceHistory(
  q: { symbol: string; interval: BinanceInterval; from: number; to: number },
  deps: FetchDeps = {},
): Promise<{ bars: Bars; from: number; to: number }> {
  const doFetch = deps.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  if (!STEP[q.interval]) throw new LabDataError(`unsupported interval ${q.interval}`);
  const rows: Array<[number, number, number, number, number]> = [];
  let start = q.from;
  let host = 0;
  for (let page = 0; start <= q.to; page++) {
    const url = `${HOSTS[host]}/api/v3/klines?symbol=${encodeURIComponent(q.symbol)}&interval=${q.interval}&startTime=${start}&endTime=${q.to}&limit=1000`;
    let res: Response;
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      if (host + 1 < HOSTS.length) { host++; page--; continue; }
      throw new LabDataError(`Binance klines: network error (${e instanceof Error ? e.name : "unknown"})`);
    }
    const body = (await res.json().catch(() => null)) as Array<[number, string, string, string, string]> | { msg?: string } | null;
    if (!res.ok || !Array.isArray(body)) throw new LabDataError(`Binance klines for ${q.symbol}: ${(body as { msg?: string } | null)?.msg ?? `HTTP ${res.status}`}`);
    if (!body.length) {
      if (!rows.length) throw new LabDataError(`Binance has no bars for ${q.symbol} ${q.interval} in that range`);
      break;
    }
    for (const r of body) {
      const t = Number(r[0]);
      if (rows.length && t <= rows[rows.length - 1][0]) continue;
      rows.push([t, Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])]);
    }
    if (body.length < 1000) break;
    start = rows[rows.length - 1][0] + STEP[q.interval];
    await sleep(120); // stay far below the public weight limit
  }
  return { bars: makeBars(rows), from: rows[0][0], to: rows[rows.length - 1][0] };
}
