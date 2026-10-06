import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/http/logger";
import { aiJson } from "@/lib/ai";
import { FEE_RATE } from "@/lib/paper/engine";
import { livePrice, type PriceOf } from "@/lib/paper/account";
import { notify } from "@/lib/notify/notifications";
import type { Telegram } from "@/lib/notify/telegram";
import { runSessionSummary, runTradeLesson, type AiFn } from "@/lib/agents/run";
import { money } from "@/lib/risk/limits";
import { excursionR } from "./excursion";
import { computeMetrics, metricsText, type ClosedTrade } from "./report";
import { venueFor } from "./exits";
import { post } from "./room";
import { mandateOf } from "./view";

/** Journal prices at 8 significant digits (fills carry slippage noise like 83124.40700500002). */
const sig = (n: number) => Number(n.toPrecision(8));

export interface JournalDeps { ai?: AiFn; priceOf?: PriceOf; telegram?: Telegram | null; now?: Date }

async function openedQtyOf(positionId: string, fallback: number) {
  const agg = await prisma.sessionOrder.aggregate({ where: { positionId, purpose: "ENTRY" }, _sum: { filled: true } });
  return agg._sum.filled || fallback;
}

/**
 * Write a closed session trade into the Journal (pnlSource SESSION) with a journal-agent lesson.
 * Idempotent: the unique sessionPositionId makes a second attempt a no-op. Returns the entry id.
 */
export async function journalClosedPosition(positionId: string, deps: JournalDeps = {}) {
  const pos = await prisma.sessionPosition.findUnique({ where: { id: positionId }, include: { session: true } });
  if (!pos || !pos.closedAt || pos.journalEntryId) return null;
  const s = pos.session;
  const plan = (pos.exitPlan ?? {}) as { thesis?: string; invalidation?: string; initialStop?: number; horizonMin?: number; atr1hAtEntry?: number | null };
  const openedQty = await openedQtyOf(pos.id, pos.qty);
  // Margin in the account currency, like the net P&L it is compared with.
  const marginAtOpen = (pos.entryPrice * openedQty * pos.quoteToAccount) / pos.leverage;
  const net = pos.realizedPnl ?? 0;
  const pnlPercent = marginAtOpen > 0 ? (net / marginAtOpen) * 100 : null;

  let entryId: string;
  try {
    const entry = await prisma.journalEntry.create({
      data: {
        userId: s.userId, symbol: pos.symbol, position: pos.side, status: "CLOSED", entryPrice: sig(pos.entryPrice), exitPrice: pos.closePrice == null ? null : sig(pos.closePrice),
        pnlPercent, feeRatePercent: FEE_RATE * 100, pnlSource: "SESSION", emotion: "Neutral",
        notes: [`Agent session "${s.name}" · closed: ${pos.closeReason?.toLowerCase().replace("_", " ") ?? "closed"} · net ${money(net)}`, plan.thesis ? `Thesis: ${plan.thesis}` : "", plan.invalidation ? `Invalidation: ${plan.invalidation}` : ""].filter(Boolean).join("\n"),
        leverage: pos.leverage, margin: Math.round(marginAtOpen * 100) / 100, marginMode: "Isolated", openedAt: pos.openedAt, closedAt: pos.closedAt, sessionPositionId: pos.id,
      },
    });
    entryId = entry.id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  }
  await prisma.sessionPosition.update({ where: { id: pos.id }, data: { journalEntryId: entryId } });

  if (s.llmBudgetHit) {
    await post(s.id, "JOURNAL", "TEXT", `Journaled ${pos.side} ${pos.symbol} (net ${money(net)}). AI budget reached — no written lesson.`, { journalEntryId: entryId });
    return entryId;
  }
  try {
    const ai = deps.ai ?? (aiJson as AiFn);
    const text = [
      `Trade: ${pos.side} ${pos.symbol}, entry ${pos.entryPrice}, exit ${pos.closePrice}, quantity ${openedQty}, leverage ${pos.leverage}x`,
      `Initial stop ${plan.initialStop ?? pos.stopLoss ?? "none"}, target ${pos.takeProfit ?? "none"}, closed by ${pos.closeReason ?? "unknown"}`,
      `Net P&L after fees ${money(net)} (${pnlPercent == null ? "n/a" : `${pnlPercent.toFixed(2)}% of margin`}), held ${Math.round((pos.closedAt.getTime() - pos.openedAt.getTime()) / 60_000)} min of a planned ${plan.horizonMin ?? "unknown"} min`,
      ...tradeFacts(pos, plan),
      `Thesis: ${plan.thesis ?? "n/a"}`,
      `Invalidation condition: ${plan.invalidation ?? "n/a"}`,
    ].join("\n");
    const r = await runTradeLesson({ ai, userId: s.userId, mandate: mandateOf(s) }, text);
    await prisma.tradeLesson.create({
      data: {
        userId: s.userId, journalEntryId: entryId, symbol: pos.symbol, position: pos.side, outcome: r.data.outcome, pnlPercent,
        rootCause: r.data.rootCause, mistakes: r.data.mistakes, strengths: r.data.strengths, lesson: r.data.lesson, tags: [...r.data.tags, "agent-session"],
      },
    });
    await prisma.tradingSession.update({ where: { id: s.id }, data: { llmCostUsd: { increment: r.costUsd } } });
    await post(s.id, "JOURNAL", "TEXT", `${pos.side} ${pos.symbol}: ${r.data.outcome} (net ${money(net)}).\nLesson: ${r.data.lesson}`, { journalEntryId: entryId, lesson: r.data }, { costUsd: r.costUsd });
  } catch (e) {
    logger.warn({ positionId, err: e instanceof Error ? e.message : String(e) }, "session journal lesson failed");
    await post(s.id, "JOURNAL", "TEXT", `Journaled ${pos.side} ${pos.symbol} (net ${money(net)}); the written lesson is unavailable (${e instanceof Error ? e.message.slice(0, 120) : "AI error"}).`, { journalEntryId: entryId });
  }
  return entryId;
}

/** The currency session P&L is booked in: USD on paper, the venue's balance currency on an exchange (OANDA: CAD). */
async function accountCurrencyOf(s: { venue: string; connectionId: string | null }) {
  if (s.venue !== "exchange") return "USD";
  try {
    const bal = await (await venueFor(s)).balance();
    if (bal?.currency) return bal.currency;
  } catch {
    // fall through to the connection's quote currency
  }
  const conn = s.connectionId ? await prisma.exchangeConnection.findUnique({ where: { id: s.connectionId }, select: { provider: true, quote: true } }) : null;
  return conn && conn.provider !== "oanda" ? conn.quote : undefined;
}

/** Measured facts for the journal agent: stop distance in ATR and the best / worst excursion in R. */
function tradeFacts(
  pos: { side: "LONG" | "SHORT"; entryPrice: number; stopLoss: number | null; bestPrice: number | null; worstPrice: number | null; closePrice: number | null },
  plan: { initialStop?: number; atr1hAtEntry?: number | null },
) {
  const stop = plan.initialStop ?? pos.stopLoss;
  const out: string[] = [];
  if (stop != null && plan.atr1hAtEntry) {
    const d = Math.abs(pos.entryPrice - stop);
    out.push(`Initial stop distance ${sig(d)} = ${(d / plan.atr1hAtEntry).toFixed(2)}× the 1H ATR at entry (${sig(plan.atr1hAtEntry)})`);
  } else out.push("Stop distance in ATR: unavailable (no ATR recorded at entry)");
  const x = excursionR({ side: pos.side, entryPrice: pos.entryPrice, initialStop: stop, bestPrice: pos.bestPrice, worstPrice: pos.worstPrice, closePrice: pos.closePrice });
  out.push(x
    ? `Best move in favour ${x.mfeR.toFixed(2)}R, worst move against ${x.maeR.toFixed(2)}R (best ${pos.bestPrice ?? "n/a"}, worst ${pos.worstPrice ?? "n/a"})`
    : "Best / worst excursion: unavailable");
  return out;
}

/** Final report once a session has ended and every position is closed. Idempotent. */
export async function writeReport(sessionId: string, deps: JournalDeps = {}) {
  const s = await prisma.tradingSession.findUnique({ where: { id: sessionId }, include: { positions: true, report: { select: { id: true } } } });
  if (!s || s.report || !["ENDED", "HALTED"].includes(s.status) || s.positions.some((p) => !p.closedAt)) return null;
  const m = mandateOf(s);
  const priceOf = deps.priceOf ?? livePrice;
  const trades: Array<ClosedTrade & { reason: string | null }> = [];
  for (const p of s.positions) {
    const plan = (p.exitPlan ?? {}) as { initialStop?: number };
    trades.push({
      symbol: p.symbol, side: p.side, entryPrice: p.entryPrice, openedQty: await openedQtyOf(p.id, p.qty), initialStop: plan.initialStop ?? p.stopLoss, quoteToAccount: p.quoteToAccount,
      realizedPnl: p.realizedPnl ?? 0, closedAt: p.closedAt!.getTime(), reason: p.closeReason,
    });
  }
  const verdicts = await prisma.sessionMessage.findMany({ where: { sessionId, kind: "VERDICT" }, select: { data: true } });
  const rejectionReasons = verdicts.flatMap((v) => {
    const d = v.data as { kind?: string; reasons?: string[] } | null;
    return d?.kind === "rejected" ? (d.reasons ?? []).slice(0, 1) : [];
  });
  const first = m.symbols[0];
  const startPrice = ((s.startPrices ?? {}) as Record<string, number | null>)[first] ?? null;
  const endPrice = await priceOf(first).catch(() => null);
  const metrics = computeMetrics({
    capital: s.capital, grossPnl: s.realizedPnl, fees: s.fees, llmCostUsd: s.llmCostUsd, accountCurrency: await accountCurrencyOf(s), trades, rejectionReasons,
    buyAndHold: { symbol: first, startPrice, endPrice }, startedAt: s.startedAt.getTime(), endedAt: (s.endedAt ?? deps.now ?? new Date()).getTime(), cycles: s.cycleCount,
  });

  let summary = "AI summary unavailable.";
  let lessons: string[] = [];
  let cost = 0;
  if (!s.llmBudgetHit) {
    try {
      const r = await runSessionSummary({ ai: deps.ai ?? (aiJson as AiFn), userId: s.userId, mandate: m }, metricsText(s.name, metrics, trades));
      summary = r.data.summary;
      lessons = r.data.lessons;
      cost = r.costUsd;
    } catch (e) {
      logger.warn({ sessionId, err: e instanceof Error ? e.message : String(e) }, "session summary failed");
    }
  } else {
    summary = "AI budget reached — the report contains the computed metrics only.";
  }
  metrics.llmCostUsd += cost;
  if (metrics.netAfterLlm != null) metrics.netAfterLlm -= cost;
  try {
    await prisma.sessionReport.create({ data: { sessionId, summary, lessons: lessons as Prisma.InputJsonValue, metrics: metrics as unknown as Prisma.InputJsonValue } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  }
  if (cost) await prisma.tradingSession.update({ where: { id: sessionId }, data: { llmCostUsd: { increment: cost } } });
  const headline = `Net ${money(metrics.netPnl)} (${metrics.returnPct.toFixed(2)}%) after ${money(metrics.fees)} fees · AI ${money(metrics.llmCostUsd)} · ${metrics.trades} trade(s)${metrics.buyAndHold ? ` · hold ${metrics.buyAndHold.symbol} ${metrics.buyAndHold.returnPct.toFixed(2)}%` : ""}`;
  await post(sessionId, "JOURNAL", "REPORT", `Session report — ${headline}\n\n${summary}`, { metrics, lessons }, { costUsd: cost || undefined });
  await notify(s.userId, { type: "session", title: `${s.name}: report ready`, body: headline, data: { sessionId, href: `/sessions/${sessionId}` } }, deps.telegram).catch(() => undefined);
  return metrics;
}
