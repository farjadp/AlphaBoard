/** Prisma rows → the client wire format in lib/types/userData.ts. Pure; unit-tested. */
import type {
  ChartLesson as ChartLessonRow, JournalEntry as JournalRow, PriceAlert as AlertRow,
  Signal as SignalRow, TradeLesson as LessonRow,
} from "@prisma/client";
import type {
  Annotation, ArchivedSignal, ChartLesson, JournalEntry, PostMortemAnalysis, PriceAlert,
  TimeframeChart, TradeLesson,
} from "@/lib/types/userData";

export const attachmentUrl = (id: string) => `/api/attachments/${id}`;

/** Removes keys whose value is undefined, so optional DTO fields are absent rather than present-but-empty. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k];
  return o;
}
const u = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export function journalToDto(r: JournalRow): JournalEntry {
  return compact<JournalEntry>({
    id: r.id,
    timestamp: r.openedAt.toISOString(),
    symbol: r.symbol,
    position: r.position,
    entryPrice: r.entryPrice,
    exitPrice: u(r.exitPrice),
    pnlPercent: u(r.pnlPercent),
    grossPnlPercent: u(r.grossPnlPercent),
    feeRatePercent: u(r.feeRatePercent),
    pnlSource: u(r.pnlSource) as JournalEntry["pnlSource"],
    emotion: r.emotion as JournalEntry["emotion"],
    notes: r.notes,
    leverage: u(r.leverage),
    margin: u(r.margin),
    marginMode: u(r.marginMode) as JournalEntry["marginMode"],
    status: r.status,
    screenshotUrl: r.screenshotId ? attachmentUrl(r.screenshotId) : undefined,
    postMortem: u(r.postMortem) as PostMortemAnalysis | undefined,
  });
}

export function lessonToDto(r: LessonRow): TradeLesson {
  return compact<TradeLesson>({
    id: r.id,
    tradeId: r.journalEntryId ?? "",
    symbol: r.symbol,
    position: r.position,
    outcome: r.outcome as TradeLesson["outcome"],
    pnlPercent: u(r.pnlPercent),
    timeframe: u(r.timeframe),
    rootCause: r.rootCause,
    mistakes: r.mistakes,
    strengths: r.strengths,
    lesson: r.lesson,
    tags: r.tags,
    emotion: u(r.emotion),
    timestamp: r.createdAt.toISOString(),
  });
}

export function signalToDto(r: SignalRow): ArchivedSignal {
  return compact<ArchivedSignal>({
    id: r.id,
    timestamp: r.createdAt.toISOString(),
    symbol: r.symbol,
    price: r.priceAtSignal,
    signal: r.signal,
    confidence: r.confidence,
    timeframe: r.timeframe,
    entry: r.entry,
    stopLoss: r.stopLoss,
    takeProfit: r.takeProfit,
    tradeStyle: u(r.tradeStyle),
    risk_management: u(r.riskManagement) as ArchivedSignal["risk_management"],
    reasoning: r.reasoning,
    indicators_breakdown: u(r.indicatorsBreakdown) as ArchivedSignal["indicators_breakdown"],
  });
}

type StoredChart = { timeframe: TimeframeChart["timeframe"]; attachmentId: string; annotations?: Annotation[]; signal?: TimeframeChart["signal"]; bias?: string };

function isStoredChart(v: unknown): v is StoredChart {
  const c = v as StoredChart | null;
  return !!c && typeof c === "object" && typeof c.timeframe === "string" && typeof c.attachmentId === "string";
}

export function chartLessonToDto(r: ChartLessonRow): ChartLesson {
  const raw: unknown[] = Array.isArray(r.charts) ? (r.charts as unknown[]) : [];
  return compact<ChartLesson>({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    symbol: u(r.symbol),
    overallSignal: r.overallSignal as ChartLesson["overallSignal"],
    confluenceScore: r.confluenceScore,
    summary: r.summary,
    lesson: r.lesson,
    patterns: r.patterns,
    tags: r.tags,
    mistakes: r.mistakes,
    strengths: r.strengths,
    charts: raw.filter(isStoredChart).map((c) => compact<TimeframeChart>({
      timeframe: c.timeframe,
      imageDataUrl: attachmentUrl(c.attachmentId),
      annotations: c.annotations ?? [],
      signal: c.signal,
      bias: c.bias,
    })),
  });
}

export function alertToDto(r: AlertRow): PriceAlert {
  return compact<PriceAlert>({
    id: r.id,
    symbol: r.symbol,
    targetPrice: r.targetPrice,
    condition: r.condition,
    triggered: r.triggered,
    triggeredAt: r.triggeredAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
  });
}
