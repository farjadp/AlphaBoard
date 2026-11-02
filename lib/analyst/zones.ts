/**
 * Analyst zones (P18a), pure: when did price reach a zone, when did a candle close beyond a level, and how did
 * price react afterwards. Zones are in the analyst's prices; bars come from our feed, so `offset` (feed − analyst,
 * e.g. gold futures above spot) is subtracted from every bar price before comparing.
 */
export interface Bar { time: number; open: number; high: number; low: number; close: number }
export type ZoneKind = "BUY" | "SELL" | "TARGET" | "INVALIDATION" | "INFO";
export interface ZoneLike { kind: ZoneKind; low: number; high: number; direction?: string | null }

const HOUR = 3_600_000;
export const SCORE_WINDOW_MS = 24 * HOUR;
/** A reaction counts when price moves away by at least the zone's width, and never less than 0.3 % of price. */
const MIN_REACTION_PCT = 0.003;

const shift = (b: Bar, offset: number): Bar =>
  offset ? { time: b.time, open: b.open - offset, high: b.high - offset, low: b.low - offset, close: b.close - offset } : b;
const ordered = (bars: Bar[], from: number) => bars.filter((b) => b.time >= from).sort((x, y) => x.time - y.time);

/** First bar at/after `from` whose range overlaps the zone. The price is the open clamped into the zone. */
export function zoneTouched(z: ZoneLike, bars: Bar[], from: number, offset: number): { at: number; price: number } | null {
  for (const raw of ordered(bars, from)) {
    const b = shift(raw, offset);
    if (b.low <= z.high && b.high >= z.low) return { at: b.time, price: Math.min(z.high, Math.max(z.low, b.open)) };
  }
  return null;
}

/** First closed bar (started at/after `from`, ended by `now`) closing beyond the level in the zone's direction. */
export function closedBeyond(z: ZoneLike, bars: Bar[], from: number, tfMs: number, now: number, offset: number): { at: number; close: number } | null {
  for (const raw of ordered(bars, from)) {
    if (raw.time + tfMs > now) break;
    const b = shift(raw, offset);
    if (z.direction === "ABOVE" ? b.close > z.high : z.direction === "BELOW" ? b.close < z.low : false) return { at: b.time, close: b.close };
  }
  return null;
}

/**
 * How price reacted after touching a BUY/SELL zone, on 1H bars from the bar containing the touch: RESPECTED when it
 * moved away by the reaction size before any closed bar finished beyond the far edge, BROKE when that close came
 * first, UNCLEAR after 24 h without either. mfe/mae are measured from the near edge. null = not decided yet.
 */
export function scoreReaction(z: ZoneLike, bars1h: Bar[], touchedAt: number, now: number, offset: number): { outcome: "RESPECTED" | "BROKE" | "UNCLEAR"; mfe: number; mae: number } | null {
  const up = z.kind === "BUY";
  const near = up ? z.high : z.low;
  const need = Math.max(z.high - z.low, near * MIN_REACTION_PCT);
  const end = touchedAt + SCORE_WINDOW_MS;
  let mfe = -Infinity;
  let mae = -Infinity;
  const round = (n: number) => Math.round(n * 1e8) / 1e8;
  for (const raw of bars1h.filter((b) => b.time + HOUR > touchedAt && b.time < end).sort((x, y) => x.time - y.time)) {
    const b = shift(raw, offset);
    mfe = Math.max(mfe, up ? b.high - near : near - b.low);
    mae = Math.max(mae, up ? near - b.low : b.high - near);
    if (mfe >= need) return { outcome: "RESPECTED", mfe: round(mfe), mae: round(mae) };
    if (b.time + HOUR <= now && (up ? b.close < z.low : b.close > z.high)) return { outcome: "BROKE", mfe: round(mfe), mae: round(mae) };
  }
  if (now < end) return null;
  return { outcome: "UNCLEAR", mfe: Number.isFinite(mfe) ? round(mfe) : 0, mae: Number.isFinite(mae) ? round(mae) : 0 };
}

const sourceKey = (s: string) => s.trim().toLowerCase();

/** zone id → the other sources whose same-symbol, same-kind zone overlaps it (edges touching count). */
export function agreements(zones: Array<ZoneLike & { id: string; symbol: string; source: string }>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of zones) {
    for (const b of zones) {
      if (a === b || a.symbol !== b.symbol || a.kind !== b.kind || sourceKey(a.source) === sourceKey(b.source)) continue;
      if (a.low > b.high || b.low > a.high) continue;
      const list = out.get(a.id) ?? [];
      if (!list.some((s) => sourceKey(s) === sourceKey(b.source))) list.push(b.source.trim());
      out.set(a.id, list);
    }
  }
  return out;
}

/** The label of a plan event within `windowMs` of `at`, or null. */
export function nearEvent(at: number, events: Array<{ at: string; label: string }>, windowMs = 2 * HOUR): string | null {
  return events.find((e) => Math.abs(Date.parse(e.at) - at) <= windowMs)?.label ?? null;
}
