import { z } from "zod";
import { ASSET_CATALOG } from "@/lib/market/catalog";
import { matchCatalogSymbol } from "@/lib/market/symbols";
import type { ZoneKind } from "./zones";

/**
 * "Paste an analysis" (P18a): what the model reads from a written or transcribed market analysis, and the pure step
 * that turns it into a plan draft. The draft is never watched by itself: the owner reviews it, confirms every
 * uncertain zone and presses Activate. The model's output is untrusted, so every field is re-checked here.
 */
export const MAX_ZONES = 60;
const FAR_FROM_REFERENCE = 0.2;
export type CloseTf = "1H" | "4H" | "1D";
const CLOSE_TFS = new Set<string>(["1H", "4H", "1D"]);
const KINDS = new Set<ZoneKind>(["BUY", "SELL", "TARGET", "INVALIDATION", "INFO"]);

const text = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null), z.string().nullable()).default(null);
const list = z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown())).default([]);

/** A model may name the lists differently ("levels", "areas"); map the common spellings before validating. */
const lists = (v: unknown) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  return {
    ...o,
    zones: o.zones ?? o.levels ?? o.areas ?? o.setups,
    refPrices: o.refPrices ?? o.ref_prices ?? o.currentPrices ?? o.prices,
    events: o.events ?? o.riskEvents ?? o.risk_events,
  };
};

export const AnalystExtractFields = z.object({
  source: text(80),
  title: text(120),
  refPrices: list,
  events: list,
  zones: list,
});
export const AnalystExtractSchema = z.preprocess(lists, AnalystExtractFields);
export type AnalystExtract = z.output<typeof AnalystExtractSchema>;

const n = (t: "string" | "number") => ({ type: [t, "null"] });
/** Closed JSON Schema for schema-constrained providers; AnalystExtractSchema and draftFromExtract stay the real validators. */
export const ANALYST_EXTRACT_JSON = {
  type: "object",
  properties: {
    source: n("string"),
    title: n("string"),
    refPrices: {
      type: "array",
      items: { type: "object", properties: { symbol: { type: "string" }, price: { type: "number" } }, required: ["symbol", "price"], additionalProperties: false },
    },
    events: {
      type: "array",
      items: { type: "object", properties: { at: { type: "string" }, label: { type: "string" } }, required: ["at", "label"], additionalProperties: false },
    },
    zones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          kind: { type: "string", enum: [...KINDS] },
          low: { type: "number" },
          high: { type: "number" },
          direction: { type: ["string", "null"], enum: ["ABOVE", "BELOW", null] },
          closeTf: { type: ["string", "null"], enum: ["1H", "4H", "1D", null] },
          condition: n("string"),
          note: n("string"),
          uncertain: { type: "boolean" },
        },
        required: ["symbol", "kind", "low", "high", "direction", "closeTf", "condition", "note", "uncertain"],
        additionalProperties: false,
      },
    },
  },
  required: ["source", "title", "refPrices", "events", "zones"],
  additionalProperties: false,
} as const;

export const ANALYST_EXTRACT_PROMPT = `Read this market analysis (Persian or English; often a summary or an automatic transcript of a video) and list every price zone and level it gives.

Return ONLY a JSON object:
- "source": the analyst's name if stated, else null. "title": a short title (e.g. the week it covers), else null.
- "refPrices": the current price the analysis states for each instrument ("current price 3875"), as { "symbol", "price" }. [] when none.
- "events": scheduled risk events it names with a date and time (NFP, CPI, FOMC, elections), as { "at": ISO 8601 UTC, "label" }. Skip any without a clear date.
- "zones": one entry per zone or level, as { "symbol", "kind", "low", "high", "direction", "closeTf", "condition", "note", "uncertain" }:
  - "symbol": the instrument as written (e.g. "XAUUSD", "طلا", "US30", "DXY").
  - "kind": "BUY" = an area to buy from; "SELL" = an area to sell from (resistance to sell); "TARGET" = a price objective; "INVALIDATION" = a level that cancels the scenario when price closes beyond it; "INFO" = any other level worth showing (liquidity, current range edges).
  - "low"/"high": the two ends of the zone ("3865 to 3850" → 3850 and 3865). A single price → the same number in both.
  - "direction": for INVALIDATION only, "ABOVE" or "BELOW" (which side cancels the scenario); else null. "closeTf": the timeframe whose close counts ("1H", "4H", "1D"), or null.
  - "condition": the entry condition as written ("only with a trigger on a lower timeframe"), else null. "note": a few words of context, else null.
  - "uncertain": true when the text itself marks the number as unclear (⚠️, "check on the chart", two conflicting numbers, a garbled figure such as "12400" for a pair that trades near 1.16).

Use exactly these key names and these English "kind" values. Write every price as a JSON number with Western digits (3850, not "۳۸۵۰"). Copy the value exactly as written; never correct, round or invent one — mark doubt with "uncertain" instead. Ignore claims about past profits, critiques and general commentary.

Example of the exact shape:
{"source":"Nima","title":"Week of Nov 2","refPrices":[{"symbol":"XAUUSD","price":3875}],"events":[{"at":"2026-11-06T13:30:00Z","label":"NFP"}],"zones":[{"symbol":"XAUUSD","kind":"SELL","low":3940,"high":3976,"direction":null,"closeTf":null,"condition":null,"note":"fib 38-50%","uncertain":false},{"symbol":"XAUUSD","kind":"INVALIDATION","low":3976,"high":3976,"direction":"ABOVE","closeTf":"4H","condition":null,"note":null,"uncertain":false}]}`;

/** Persian and Arabic-Indic digits and separators → ASCII, so "۳۸۵۰" and "۱٫۳۴" read as numbers. */
export function westernDigits(text: string): string {
  return text
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u066B/g, ".")
    .replace(/\u066C/g, ",");
}

/** Persian names, CFD tickers and plain words → catalog symbol. Keys are lower-case with spaces and ZWNJ removed. */
const NAMES: Record<string, string> = {
  طلا: "XAU/USD", انس: "XAU/USD", gold: "XAU/USD", xau: "XAU/USD",
  نقره: "XAG/USD", silver: "XAG/USD",
  داوجونز: "DJI", داو: "DJI", dow: "DJI", dowjones: "DJI", us30: "DJI", dj30: "DJI", wallstreet: "DJI", djia: "DJI",
  نزدک: "NDX", nasdaq: "NDX", nas100: "NDX", us100: "NDX", ustec: "NDX",
  sp500: "SPX", "s&p500": "SPX", us500: "SPX", spx500: "SPX",
  بیتکوین: "BTC/USDT", bitcoin: "BTC/USDT", btc: "BTC/USDT",
  اتریوم: "ETH/USDT", ethereum: "ETH/USDT", eth: "ETH/USDT",
  dxy: "DXY", usdx: "DXY", dollarindex: "DXY", شاخصدلار: "DXY", دلار: "DXY",
  یورودلار: "EUR/USD", پونددلار: "GBP/USD",
  نفت: "WTI", oil: "WTI", usoil: "WTI", crude: "WTI",
};

/** A symbol as an analyst writes it → catalog symbol, or null when we have no market data for it. */
export function catalogSymbolOf(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[\s\u200c_/-]+/g, "").replace(/\.[a-z0-9]{1,5}$/, "");
  return NAMES[key] ?? matchCatalogSymbol(raw, ASSET_CATALOG);
}

export interface ZoneDraft {
  symbol: string;
  kind: ZoneKind;
  low: number;
  high: number;
  direction: "ABOVE" | "BELOW" | null;
  closeTf: CloseTf | null;
  condition: string | null;
  note: string | null;
  uncertain: boolean;
}

export interface PlanDraft {
  source: string | null;
  title: string | null;
  /** The analyst's stated current price per catalog symbol (for the feed offset). */
  refPrices: Record<string, number>;
  events: Array<{ at: string; label: string }>;
  expiresAt: string;
  zones: ZoneDraft[];
  warnings: string[];
}

const positive = (v: unknown) => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(westernDigits(v).replace(/[,\s$]/g, "")) : NaN;
  return Number.isFinite(x) && x > 0 ? x : null;
};
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const fmtRange = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo}–${hi}`);

/** Kind words a model may use instead of the requested English values. Keys lower-case, spaces and ZWNJ removed. */
const KIND_ALIASES: Record<string, ZoneKind> = {
  buy: "BUY", long: "BUY", buyzone: "BUY", demand: "BUY", support: "BUY", خرید: "BUY", ناحیهخرید: "BUY", زونخرید: "BUY", حمایت: "BUY",
  sell: "SELL", short: "SELL", sellzone: "SELL", supply: "SELL", resistance: "SELL", فروش: "SELL", ناحیهفروش: "SELL", زونفروش: "SELL", مقاومت: "SELL",
  target: "TARGET", tp: "TARGET", takeprofit: "TARGET", objective: "TARGET", تارگت: "TARGET", هدف: "TARGET",
  invalidation: "INVALIDATION", stop: "INVALIDATION", stoploss: "INVALIDATION", ابطال: "INVALIDATION", حدضرر: "INVALIDATION",
  info: "INFO", level: "INFO", liquidity: "INFO", other: "INFO", اطلاعات: "INFO", نقدینگی: "INFO",
};
const kindOf = (v: unknown): ZoneKind | null => {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase().replace(/[\s\u200c_-]+/g, "");
  return KINDS.has(k.toUpperCase() as ZoneKind) ? (k.toUpperCase() as ZoneKind) : KIND_ALIASES[k] ?? null;
};
/** The first of several key spellings that is present on the object. */
const pick = (o: Record<string, unknown>, ...keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== "");

/** Next Saturday 00:00 UTC strictly after `now`: the plan covers the rest of the trading week. */
export function weekEnd(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + (((6 - d.getUTCDay()) + 7) % 7 || 7));
  return d;
}

/**
 * Model output → plan draft plus plain-language warnings. `feed` (catalog symbol → last price) is the fallback
 * reference when the analysis states no current price, so a garbled number far from the market gets flagged.
 */
export function draftFromExtract(x: AnalystExtract, now: Date, feed: Record<string, number | null> = {}): PlanDraft {
  const warnings: string[] = [];

  const refPrices: Record<string, number> = {};
  for (const r of x.refPrices.map(rec)) {
    const sym = typeof r.symbol === "string" ? catalogSymbolOf(westernDigits(r.symbol)) : null;
    const price = positive(r.price);
    if (sym && price) refPrices[sym] = price;
  }

  const events: PlanDraft["events"] = [];
  for (const e of x.events.map(rec)) {
    const label = str(e.label, 60);
    const at = typeof e.at === "string" ? Date.parse(e.at) : NaN;
    if (!label) continue;
    if (Number.isFinite(at)) events.push({ at: new Date(at).toISOString(), label });
    else warnings.push(`Event "${label}" has no clear date: add it by hand if it matters`);
  }

  const zones: ZoneDraft[] = [];
  const unknown = new Set<string>();
  let dropped = 0;
  x.zones.forEach((item, i) => {
    if (zones.length >= MAX_ZONES) return;
    const z = rec(item);
    const rawSymbol = str(pick(z, "symbol", "instrument", "asset", "pair", "market"), 40);
    const rawKind = pick(z, "kind", "type", "side", "role");
    const kind = kindOf(rawKind);
    const single = positive(pick(z, "price", "level"));
    let low = positive(pick(z, "low", "from", "min", "lower", "priceLow", "price_low", "start")) ?? single;
    let high = positive(pick(z, "high", "to", "max", "upper", "priceHigh", "price_high", "end")) ?? single;
    const what = `Zone ${i + 1}${rawSymbol ? ` (${rawSymbol})` : ""}`;
    if (!rawSymbol || !kind || (low == null && high == null)) {
      dropped++;
      warnings.push(`${what} was left out: ${!rawSymbol ? "no symbol" : !kind ? `unknown kind "${String(rawKind ?? "")}"` : "no usable price"}`);
      return;
    }
    const symbol = catalogSymbolOf(westernDigits(rawSymbol));
    if (!symbol) { unknown.add(rawSymbol); return; }
    low ??= high!;
    high ??= low;
    if (low > high) [low, high] = [high, low];

    let zoneKind = kind;
    let direction: ZoneDraft["direction"] = null;
    let closeTf: CloseTf | null = null;
    if (kind === "INVALIDATION") {
      const rawDir = pick(z, "direction", "side_to_break", "breakSide");
      const dir = typeof rawDir === "string" ? (/above|up|بالا/i.test(rawDir) ? "ABOVE" : /below|down|پایین/i.test(rawDir) ? "BELOW" : "") : "";
      if (dir === "ABOVE" || dir === "BELOW") {
        direction = dir;
        const tf = typeof z.closeTf === "string" ? z.closeTf.toUpperCase() : "";
        closeTf = CLOSE_TFS.has(tf) ? (tf as CloseTf) : "4H";
      } else {
        zoneKind = "INFO";
        warnings.push(`${symbol} ${fmtRange(low, high)}: no clear direction for the invalidation, kept as info`);
      }
    }

    let uncertain = z.uncertain === true || z.uncertain === "true";
    const ref = refPrices[symbol] ?? feed[symbol] ?? null;
    if (ref && Math.abs((low + high) / 2 - ref) / ref > FAR_FROM_REFERENCE) {
      uncertain = true;
      warnings.push(`${symbol} ${fmtRange(low, high)} is far from the reference price ${ref}: check it`);
    }
    zones.push({ symbol, kind: zoneKind, low, high, direction, closeTf, condition: str(z.condition, 200), note: str(z.note, 200), uncertain });
  });
  if (x.zones.length > MAX_ZONES) warnings.push(`Only the first ${MAX_ZONES} zones were kept`);
  if (x.zones.length === 0) warnings.push("The model found no zones in this text: check that it lists prices, or add zones by hand");
  else if (zones.length === 0 && dropped > 0) warnings.push(`None of the ${x.zones.length} zones the model returned could be read`);
  for (const s of unknown) warnings.push(`No market data for "${s}": its zones were left out`);

  return { source: x.source, title: x.title, refPrices, events, expiresAt: weekEnd(now).toISOString(), zones, warnings };
}
