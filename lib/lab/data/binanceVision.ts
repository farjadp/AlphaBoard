import "server-only";
import { LabDataError } from "./encode";
import { readSingleZipEntry } from "./zip";

/**
 * Binance public data archive (data.binance.vision): monthly 1-hour USD-M futures klines for every
 * symbol that ever listed — delisted ones included, which is what keeps a basket test free of
 * survivorship bias.
 */
const LIST = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision";
const FILES = "https://data.binance.vision";
const PREFIX = "data/futures/um/monthly/klines/";
const HOUR = 3_600_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface VisionDeps { fetch?: Fetch; concurrency?: number }

export interface SymbolSeries {
  symbol: string;
  /** Hours since the epoch of the first bar; the arrays then cover every hour to the last bar (NaN = no bar). */
  startHour: number;
  o: Float32Array; h: Float32Array; l: Float32Array; c: Float32Array;
}

export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
}

/** Kline CSV (with or without a header row; times in ms or µs) → columns. */
export function parseKlineCsv(text: string): { t: number[]; o: number[]; h: number[]; l: number[]; c: number[] } {
  const r = { t: [] as number[], o: [] as number[], h: [] as number[], l: [] as number[], c: [] as number[] };
  for (const line of text.split("\n")) {
    if (!line || line.charCodeAt(0) < 48 || line.charCodeAt(0) > 57) continue;
    const f = line.split(",");
    let t = Number(f[0]);
    if (t > 1e14) t = Math.floor(t / 1000); // microseconds
    r.t.push(t); r.o.push(Number(f[1])); r.h.push(Number(f[2])); r.l.push(Number(f[3])); r.c.push(Number(f[4]));
  }
  return r;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k]); }
  }));
  return out;
}

/** USDT-margined symbols that have a monthly 1h kline file for `month` ("YYYY-MM"). */
export async function listListedSymbols(month: string, deps: VisionDeps = {}): Promise<string[]> {
  const doFetch = deps.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const all: string[] = [];
  let marker = "";
  for (let page = 0; page < 20; page++) {
    const url = `${LIST}?prefix=${encodeURIComponent(PREFIX)}&delimiter=/${marker ? `&marker=${encodeURIComponent(marker)}` : ""}`;
    const res = await doFetch(url);
    if (!res.ok) throw new LabDataError(`Binance archive listing failed (HTTP ${res.status})`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)) {
      const sym = m[1].slice(PREFIX.length).replace(/\/$/, "");
      if (sym && sym.endsWith("USDT")) all.push(sym);
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    marker = /<NextMarker>([^<]+)<\/NextMarker>/.exec(xml)?.[1] ?? "";
    if (!marker) break;
  }
  const has = await pool(all, deps.concurrency ?? 32, async (s) => {
    const r = await doFetch(`${FILES}/${PREFIX}${s}/1h/${s}-1h-${month}.zip`, { method: "HEAD" }).catch(() => null);
    return !!r && r.ok;
  });
  return all.filter((_, k) => has[k]).sort();
}

/** Monthly zips → one continuous hourly series per symbol (missing months stay NaN). */
export async function buildBasketSeries(symbols: string[], from: string, to: string, deps: VisionDeps = {}) {
  const doFetch = deps.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const months = monthsBetween(from, to);
  const jobs = symbols.flatMap((s) => months.map((m) => ({ s, m })));
  const parts = await pool(jobs, deps.concurrency ?? 16, async ({ s, m }) => {
    const res = await doFetch(`${FILES}/${PREFIX}${s}/1h/${s}-1h-${m}.zip`).catch(() => null);
    if (!res || !res.ok) return null;
    try {
      return { s, rows: parseKlineCsv(readSingleZipEntry(Buffer.from(await res.arrayBuffer()))) };
    } catch {
      return null;
    }
  });
  const series: SymbolSeries[] = [];
  const missingSymbols: string[] = [];
  for (const s of symbols) {
    const mine = parts.filter((p): p is NonNullable<typeof p> => !!p && p.s === s && p.rows.t.length > 0);
    if (!mine.length) { missingSymbols.push(s); continue; }
    const first = Math.min(...mine.map((p) => p.rows.t[0]));
    const last = Math.max(...mine.map((p) => p.rows.t[p.rows.t.length - 1]));
    const startHour = Math.floor(first / HOUR);
    const len = Math.floor(last / HOUR) - startHour + 1;
    const col = () => new Float32Array(len).fill(Number.NaN);
    const o = col(), h = col(), l = col(), c = col();
    for (const p of mine) for (let k = 0; k < p.rows.t.length; k++) {
      const i = Math.floor(p.rows.t[k] / HOUR) - startHour;
      if (i < 0 || i >= len) continue;
      o[i] = p.rows.o[k]; h[i] = p.rows.h[k]; l[i] = p.rows.l[k]; c[i] = p.rows.c[k];
    }
    series.push({ symbol: s, startHour, o, h, l, c });
  }
  return { series, missingSymbols, files: parts.filter(Boolean).length };
}
