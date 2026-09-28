import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Analysis } from "@/lib/ai/schemas";
import { signalToDto } from "./mappers";

export async function listSignals(userId: string) {
  const rows = await prisma.signal.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500, include: { evaluation: true } });
  return rows.map(signalToDto);
}

/** Archive an AI strategy report at generation time, with the exact price the model saw. */
export async function archiveAnalysis(userId: string, a: Analysis, ctx: { symbol: string; timeframe: string; priceAtSignal: number; provider: string; model: string }) {
  const row = await prisma.signal.create({
    data: {
      userId,
      symbol: ctx.symbol,
      // The timeframe that was actually analysed (the model's free-text echo can differ); P5 evaluates on it.
      timeframe: ctx.timeframe,
      signal: a.signal,
      confidence: a.confidence,
      priceAtSignal: ctx.priceAtSignal,
      entry: a.entry,
      stopLoss: a.stopLoss,
      takeProfit: a.takeProfit,
      tradeStyle: a.tradeStyle ?? null,
      riskManagement: (a.risk_management ?? undefined) as Prisma.InputJsonValue | undefined,
      supportResistance: (a.supportResistance ?? undefined) as Prisma.InputJsonValue | undefined,
      safeEntries: (a.safeEntries ?? undefined) as Prisma.InputJsonValue | undefined,
      reasoning: a.reasoning,
      indicatorsBreakdown: (a.indicators_breakdown ?? undefined) as Prisma.InputJsonValue | undefined,
      provider: ctx.provider,
      model: ctx.model,
    },
  });
  return signalToDto(row);
}

export async function deleteSignal(userId: string, id: string) {
  await prisma.signal.deleteMany({ where: { id, userId } });
}

export async function clearSignals(userId: string) {
  await prisma.signal.deleteMany({ where: { userId } });
}

/** One of the user's own signals (null when missing or someone else's). */
export async function getSignal(userId: string, id: string) {
  const row = await prisma.signal.findFirst({ where: { id, userId }, include: { evaluation: true } });
  return row ? signalToDto(row) : null;
}
