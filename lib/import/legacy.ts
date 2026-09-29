/**
 * Parses AlphaBoard v1 browser data (localStorage) into validated, normalized records.
 * Used on the client (preview + image upload) and again on the server (never trust the client).
 * Invalid rows are skipped and counted, never guessed at.
 */
import { z } from "zod";
import { ASSET_CATALOG } from "@/lib/assetCatalog";

export const LEGACY_KEYS = {
  watchlist: "alphaboard_watchlist_v2",
  alerts: "alphaboard_price_alerts",
  journal: "alphaboard_trading_journal",
  signals: "alphaboard_signal_history",
  lessons: "alphaboard_trade_lessons",
  chartLessons: "alphaboard_chart_academy",
} as const;

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,/;
const str = (max: number) => z.coerce.string().transform((s) => s.slice(0, max));
const optStr = (max: number) => z.string().transform((s) => s.slice(0, max)).optional().catch(undefined);
const num = z.coerce.number().finite();
const optNum = z.coerce.number().finite().optional().catch(undefined);
const date = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()));
const strList = (maxItems: number, maxLen: number) =>
  z.array(z.coerce.string()).catch([]).transform((a) => a.slice(0, maxItems).map((s) => s.slice(0, maxLen)));
const json = z.unknown().optional();

/** An image either still embedded (client side) or already uploaded (server side). */
export type LegacyImage = { dataUrl?: string; attachmentId?: string };
const toImage = (v: unknown, attachmentId: unknown): LegacyImage | undefined => {
  if (typeof attachmentId === "string" && attachmentId) return { attachmentId };
  if (typeof v === "string" && DATA_URL.test(v)) return { dataUrl: v };
  return undefined;
};

const Alert = z.object({
  id: z.string().min(1).max(64),
  symbol: z.string().refine((s) => ASSET_CATALOG.some((a) => a.symbol === s)),
  targetPrice: num.positive(),
  condition: z.enum(["above", "below"]),
  createdAt: date.catch(() => new Date()),
  triggered: z.boolean().catch(false),
  triggeredAt: date.optional().catch(undefined),
}).transform(({ id, ...rest }) => ({ legacyId: id, ...rest }));

const Journal = z.object({
  id: z.string().min(1).max(64),
  timestamp: date.catch(() => new Date()),
  symbol: str(30),
  position: z.enum(["LONG", "SHORT", "SPOT"]),
  entryPrice: num.positive(),
  exitPrice: optNum,
  pnlPercent: optNum,
  grossPnlPercent: optNum,
  feeRatePercent: optNum,
  pnlSource: z.enum(["calculated", "exchange"]).optional().catch(undefined),
  emotion: str(20).catch("Neutral"),
  notes: str(4000).catch(""),
  leverage: optNum,
  margin: optNum,
  marginMode: z.enum(["Cross", "Isolated"]).optional().catch(undefined),
  status: z.enum(["OPEN", "CLOSED"]).catch("OPEN"),
  screenshotUrl: z.unknown().optional(),
  screenshotAttachmentId: z.unknown().optional(),
  postMortem: json,
}).transform(({ id, screenshotUrl, screenshotAttachmentId, timestamp, ...rest }) => ({
  legacyId: id, openedAt: timestamp, ...rest, screenshot: toImage(screenshotUrl, screenshotAttachmentId),
}));

const Signal = z.object({
  id: z.string().min(1).max(64),
  timestamp: date.catch(() => new Date()),
  symbol: str(30),
  price: num.nonnegative().catch(0),
  signal: z.enum(["BUY", "SELL", "HOLD"]),
  confidence: num.transform((n) => Math.round(Math.min(100, Math.max(0, n)))),
  timeframe: str(20).catch(""),
  entry: num.catch(0),
  stopLoss: num.catch(0),
  takeProfit: num.catch(0),
  tradeStyle: optStr(20),
  risk_management: json,
  reasoning: str(6000).catch(""),
  indicators_breakdown: json,
}).transform((s) => ({
  legacyId: s.id, createdAt: s.timestamp, symbol: s.symbol, priceAtSignal: s.price, signal: s.signal,
  confidence: s.confidence, timeframe: s.timeframe, entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit,
  tradeStyle: s.tradeStyle, riskManagement: s.risk_management, reasoning: s.reasoning, indicatorsBreakdown: s.indicators_breakdown,
}));

const Lesson = z.object({
  id: z.string().min(1).max(64),
  tradeId: z.string().max(64).optional().catch(undefined),
  symbol: str(30),
  position: z.enum(["LONG", "SHORT", "SPOT"]),
  outcome: z.enum(["WIN", "LOSS", "BREAKEVEN", "OPEN"]).catch("OPEN"),
  pnlPercent: optNum,
  timeframe: optStr(20),
  rootCause: str(2000).catch(""),
  mistakes: strList(8, 400),
  strengths: strList(8, 400),
  lesson: str(2000).catch(""),
  tags: strList(10, 40),
  emotion: optStr(20),
  timestamp: date.catch(() => new Date()),
}).transform(({ id, tradeId, timestamp, ...rest }) => ({ legacyId: id, journalLegacyId: tradeId, createdAt: timestamp, ...rest }));

const ChartTf = z.object({
  timeframe: z.enum(["15m", "1H", "4H", "1D"]),
  imageDataUrl: z.unknown().optional(),
  attachmentId: z.unknown().optional(),
  annotations: z.array(z.unknown()).catch([]).transform((a) => a.slice(0, 40)),
  signal: z.enum(["BUY", "SELL", "HOLD"]).optional().catch(undefined),
  bias: optStr(600),
}).transform(({ imageDataUrl, attachmentId, ...rest }) => ({ ...rest, image: toImage(imageDataUrl, attachmentId) }))
  .refine((c) => !!c.image); // a chart without an image is dropped; the lesson text is kept

const ChartLessonSchema = z.object({
  id: z.string().min(1).max(64),
  createdAt: date.catch(() => new Date()),
  symbol: optStr(30),
  overallSignal: z.enum(["BUY", "SELL", "HOLD"]),
  confluenceScore: num.transform((n) => Math.round(Math.min(100, Math.max(0, n)))),
  summary: str(3000).catch(""),
  lesson: str(3000).catch(""),
  patterns: strList(12, 80),
  tags: strList(12, 40),
  mistakes: strList(8, 400),
  strengths: strList(8, 400),
  charts: z.array(z.unknown()).catch([]),
}).transform(({ id, charts, ...rest }) => ({
  legacyId: id,
  ...rest,
  charts: charts.flatMap((c) => { const p = ChartTf.safeParse(c); return p.success ? [p.data as z.output<typeof ChartTf> & { image: LegacyImage }] : []; }).slice(0, 3),
}));

function many<S extends z.ZodType>(schema: S, raw: unknown, max: number) {
  const items = Array.isArray(raw) ? raw.slice(0, max) : [];
  const ok: z.output<S>[] = [];
  let skipped = 0;
  for (const item of items) {
    const p = schema.safeParse(item);
    if (p.success) ok.push(p.data); else skipped++;
  }
  return { ok, skipped };
}

export type LegacyInput = Partial<Record<keyof typeof LEGACY_KEYS, unknown>>;

export function parseLegacyData(input: LegacyInput) {
  const watchlist = Array.from(new Set(
    (Array.isArray(input.watchlist) ? input.watchlist : [])
      .filter((s): s is string => typeof s === "string" && ASSET_CATALOG.some((a) => a.symbol === s)),
  )).slice(0, 5);
  const alerts = many(Alert, input.alerts, 500);
  const journal = many(Journal, input.journal, 5_000);
  const signals = many(Signal, input.signals, 2_000);
  const lessons = many(Lesson, input.lessons, 2_000);
  const chartLessons = many(ChartLessonSchema, input.chartLessons, 200);

  return {
    watchlist,
    alerts: alerts.ok,
    journal: journal.ok,
    signals: signals.ok,
    lessons: lessons.ok,
    chartLessons: chartLessons.ok,
    skipped: { alerts: alerts.skipped, journal: journal.skipped, signals: signals.skipped, lessons: lessons.skipped, chartLessons: chartLessons.skipped },
    total: watchlist.length + alerts.ok.length + journal.ok.length + signals.ok.length + lessons.ok.length + chartLessons.ok.length,
  };
}
export type LegacyData = ReturnType<typeof parseLegacyData>;

/**
 * Embedded images of rows that will actually import, each with a setter that swaps the data URL
 * for an uploaded attachment id **in the raw payload** (the server re-parses the raw shape).
 */
export function collectLegacyImages(raw: LegacyInput): Array<{ dataUrl: string; setAttachmentId: (id: string) => void }> {
  const parsed = parseLegacyData(raw);
  const validJournal = new Set(parsed.journal.map((j) => j.legacyId));
  const validLessons = new Set(parsed.chartLessons.map((l) => l.legacyId));
  const out: Array<{ dataUrl: string; setAttachmentId: (id: string) => void }> = [];

  // Rows that will not import still lose their images, so nothing heavy is posted for nothing.
  for (const item of Array.isArray(raw.journal) ? raw.journal : []) {
    const j = item as Record<string, unknown>;
    if (!j || typeof j !== "object" || typeof j.screenshotUrl !== "string") continue;
    if (!validJournal.has(j.id as string) || !DATA_URL.test(j.screenshotUrl)) { delete j.screenshotUrl; continue; }
    const dataUrl = j.screenshotUrl;
    out.push({ dataUrl, setAttachmentId: (id) => { j.screenshotAttachmentId = id; delete j.screenshotUrl; } });
  }
  for (const item of Array.isArray(raw.chartLessons) ? raw.chartLessons : []) {
    const l = item as Record<string, unknown>;
    if (!l || typeof l !== "object" || !Array.isArray(l.charts)) continue;
    const keep = validLessons.has(l.id as string);
    for (const chart of l.charts as Array<Record<string, unknown>>) {
      if (!chart || typeof chart.imageDataUrl !== "string") continue;
      if (!keep || !DATA_URL.test(chart.imageDataUrl)) { delete chart.imageDataUrl; continue; }
      const dataUrl = chart.imageDataUrl;
      out.push({ dataUrl, setAttachmentId: (id) => { chart.attachmentId = id; delete chart.imageDataUrl; } });
    }
  }
  return out;
}
