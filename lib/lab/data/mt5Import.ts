import { money as fmtMoney } from "@/lib/format";
import "server-only";
import { prisma } from "@/lib/db/client";
import { badRequest } from "@/lib/http/errors";
import { DealsFileError, parseDealsCsv, positionsFromDeals } from "@/lib/lab/data/mt5Deals";

/**
 * Import an ExportDeals.mq5 CSV: every closed position becomes an Mt5Trade (the facts) plus a journal
 * row (pnlSource "MT5"). Idempotent: rows that already exist (same login + position id) are left alone.
 */
export interface Mt5TradeDto {
  positionId: string; symbol: string; side: "LONG" | "SHORT"; volume: number; entryPrice: number; exitPrice: number;
  stop: number | null; openedAt: string; closedAt: string; net: number; currency: string; magic: number; manual: boolean;
}

const money = (n: number, ccy: string) => fmtMoney(n, { currency: ccy, signed: true });

export async function importDeals(userId: string, text: string) {
  let parsed;
  try {
    parsed = parseDealsCsv(text);
  } catch (e) {
    if (e instanceof DealsFileError) throw badRequest(e.message, "MT5_BAD_FILE");
    throw e;
  }
  const { login, currency, deals } = parsed;
  const positions = positionsFromDeals(deals);
  const closed = positions.filter((p) => p.closed && p.exitPrice != null && p.closedAt != null);
  const existing = new Set((await prisma.mt5Trade.findMany({ where: { userId, login }, select: { positionId: true } })).map((r) => r.positionId));
  const fresh = closed.filter((p) => !existing.has(String(p.position)));
  await prisma.$transaction([
    prisma.mt5Trade.createMany({
      data: fresh.map((p) => ({
        userId, login, positionId: String(p.position), symbol: p.symbol, side: p.side, volume: p.volume, entryPrice: p.entryPrice,
        exitPrice: p.exitPrice!, stop: p.initialStop, openedAt: new Date(p.openedAt), closedAt: new Date(p.closedAt!), net: p.net,
        currency, magic: p.magic, manual: p.manual,
      })),
      skipDuplicates: true,
    }),
    prisma.journalEntry.createMany({
      data: fresh.map((p) => ({
        userId, legacyId: `mt5:${login}:${p.position}`, symbol: p.symbol, position: p.side, status: "CLOSED" as const,
        entryPrice: p.entryPrice, exitPrice: p.exitPrice, pnlSource: "MT5", emotion: "Neutral",
        notes: [`MT5 #${p.position} · ${p.manual ? "manual" : `expert (magic ${p.magic})`} · ${p.volume} lot · net ${money(p.net, currency)}`,
          p.initialStop ? `Stop at entry: ${p.initialStop}` : "No stop at entry"].join("\n"),
        openedAt: new Date(p.openedAt), closedAt: new Date(p.closedAt!),
      })),
      skipDuplicates: true,
    }),
  ]);
  return { login, currency, imported: fresh.length, alreadyThere: closed.length - fresh.length, stillOpen: positions.length - closed.length };
}

export async function listMt5Trades(userId: string): Promise<Mt5TradeDto[]> {
  const rows = await prisma.mt5Trade.findMany({ where: { userId }, orderBy: { openedAt: "asc" } });
  return rows.map((r) => ({
    positionId: r.positionId, symbol: r.symbol, side: r.side as "LONG" | "SHORT", volume: r.volume, entryPrice: r.entryPrice,
    exitPrice: r.exitPrice, stop: r.stop, openedAt: r.openedAt.toISOString(), closedAt: r.closedAt.toISOString(), net: r.net,
    currency: r.currency, magic: r.magic, manual: r.manual,
  }));
}
