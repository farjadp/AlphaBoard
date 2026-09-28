import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Analysis } from "@/lib/ai/schemas";
import { signalToDto } from "./mappers";

export async function listSignals(userId: string) {
  const rows = await prisma.signal.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map(signalToDto);
}

/** Archive an AI strategy report at generation time, with the exact price the model saw. */
export async function archiveAnalysis(userId: string, a: Analysis, ctx: { symbol: string; timeframe: string; priceAtSignal: number; provider: string; model: string }) {
  const row = await prisma.signal.create({
    data: {
      userId,
      symbol: ctx.symbol,
      timeframe: a.timeframe || ctx.timeframe,
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
