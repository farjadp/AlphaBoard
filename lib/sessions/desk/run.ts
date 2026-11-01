/**
 * Session agent calls. Every call goes through the injected aiJson (quota, usage logging, zod
 * validation) with the model chosen for that role in the mandate. Returns data + cost for the room.
 */
import type { z } from "zod";
import type { AiMeta, AiRequest } from "@/lib/ai";
import type { Proposal } from "@/lib/risk/verdict";
import type { Mandate } from "@/lib/sessions/mandate";
import { formatContext, type ContextData } from "./context";
import * as P from "./prompts";
import {
  AGENT_JSON_SCHEMAS, AnalystNotesSchema, DebateSchema, SessionSummarySchema, StrategistPlanSchema, TradeLessonSchema,
  type AnalystNotes, type Debate,
} from "./schemas";

export type AiFn = <S extends z.ZodType>(req: AiRequest<S>) => Promise<{ data: z.output<S>; meta: AiMeta }>;

export interface AgentDeps {
  ai: AiFn;
  userId: string;
  mandate: Mandate;
}

const TIMEOUT_MS = 90_000;

function notesText(label: string, notes: AnalystNotes) {
  return `### ${label}\n${notes.notes.map((x) => `- ${x.symbol}: ${x.stance} (${Math.round(x.confidence * 100)}%) — ${x.summary}${x.keyPoints.length ? ` [${x.keyPoints.join("; ")}]` : ""}`).join("\n") || "- no notes"}`;
}

export async function runAnalysts(d: AgentDeps, ctx: ContextData) {
  const call = (feature: string, system: string, view: "technical" | "news") => d.ai({
    feature, userId: d.userId, model: d.mandate.models.analyst, system: P.withShape(system, P.SHAPES.analystNotes), user: formatContext(ctx, view),
    schema: AnalystNotesSchema, jsonSchema: AGENT_JSON_SCHEMAS.analystNotes, maxTokens: 1_200, temperature: 0.2, timeoutMs: TIMEOUT_MS,
  });
  const [market, news] = await Promise.all([
    call("session.market", P.MARKET_ANALYST, "technical"),
    call("session.news", P.NEWS_ANALYST, "news"),
  ]);
  return { market: market.data, news: news.data, costUsd: market.meta.costUsd + news.meta.costUsd };
}

export async function runDebate(d: AgentDeps, ctx: ContextData, market: AnalystNotes, news: AnalystNotes) {
  const r = await d.ai({
    feature: "session.debate", userId: d.userId, model: d.mandate.models.strategist, system: P.withShape(P.DEBATE, P.SHAPES.debate),
    user: `${formatContext(ctx, "full")}\n\n## ANALYST NOTES\n${notesText("Market", market)}\n${notesText("News", news)}`,
    schema: DebateSchema, jsonSchema: AGENT_JSON_SCHEMAS.debate, maxTokens: 900, temperature: 0.4, timeoutMs: TIMEOUT_MS,
  });
  return { data: r.data, costUsd: r.meta.costUsd };
}

export async function runStrategist(d: AgentDeps, ctx: ContextData, market: AnalystNotes, news: AnalystNotes, debate: Debate | null) {
  const r = await d.ai({
    feature: "session.strategist", userId: d.userId, model: d.mandate.models.strategist, system: P.withShape(P.STRATEGIST, P.SHAPES.strategistPlan),
    user: [
      formatContext(ctx, "full"),
      "## ANALYST NOTES", notesText("Market", market), notesText("News", news),
      ...(debate ? ["## DEBATE", `Bull: ${debate.bull}`, `Bear: ${debate.bear}`] : []),
    ].join("\n\n"),
    schema: StrategistPlanSchema, jsonSchema: AGENT_JSON_SCHEMAS.strategistPlan, maxTokens: 2_000, temperature: 0.2, timeoutMs: TIMEOUT_MS,
  });
  const openIds = new Set(ctx.positions.map((p) => p.id));
  const dropped: string[] = [];
  const proposals: Proposal[] = [];
  for (const x of r.data.decisions) {
    if (!d.mandate.symbols.includes(x.symbol)) {
      dropped.push(`${x.action} ${x.symbol}: not in the session allowlist`);
      continue;
    }
    proposals.push({
      action: x.action, symbol: x.symbol, conviction: x.conviction, thesis: x.thesis,
      positionId: x.positionId && openIds.has(x.positionId) ? x.positionId : null,
      exitPlan: { stopLoss: x.stopLoss, takeProfit: x.takeProfit, invalidation: x.invalidation, horizonMin: x.horizonMin },
    });
  }
  return { proposals, dropped, commentary: r.data.commentary, costUsd: r.meta.costUsd };
}

export async function runTradeLesson(d: AgentDeps, tradeText: string) {
  const r = await d.ai({
    feature: "session.journal", userId: d.userId, model: d.mandate.models.journal, system: P.withShape(P.TRADE_JOURNAL, P.SHAPES.tradeLesson), user: tradeText,
    schema: TradeLessonSchema, jsonSchema: AGENT_JSON_SCHEMAS.tradeLesson, maxTokens: 900, temperature: 0.3, timeoutMs: TIMEOUT_MS,
  });
  return { data: r.data, costUsd: r.meta.costUsd };
}

export async function runSessionSummary(d: AgentDeps, reportText: string) {
  const r = await d.ai({
    feature: "session.report", userId: d.userId, model: d.mandate.models.journal, system: P.withShape(P.SESSION_SUMMARY, P.SHAPES.sessionSummary), user: reportText,
    schema: SessionSummarySchema, jsonSchema: AGENT_JSON_SCHEMAS.sessionSummary, maxTokens: 1_000, temperature: 0.3, timeoutMs: TIMEOUT_MS,
  });
  return { data: r.data, costUsd: r.meta.costUsd };
}
