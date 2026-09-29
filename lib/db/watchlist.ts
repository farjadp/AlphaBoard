import "server-only";
import { prisma } from "@/lib/prisma";
import { ASSET_CATALOG, DEFAULT_WATCHLIST } from "@/lib/assetCatalog";
import { badRequest } from "@/lib/http/errors";

export const WATCHLIST_MAX = 5;

export async function getWatchlist(userId: string): Promise<string[]> {
  const rows = await prisma.watchlistItem.findMany({ where: { userId }, orderBy: { position: "asc" }, select: { symbol: true } });
  return rows.length ? rows.map((r) => r.symbol) : DEFAULT_WATCHLIST;
}

export async function setWatchlist(userId: string, symbols: string[]): Promise<string[]> {
  const clean = Array.from(new Set(symbols)).slice(0, WATCHLIST_MAX);
  if (clean.some((s) => !ASSET_CATALOG.some((a) => a.symbol === s))) throw badRequest("Unknown symbol in watchlist", "BAD_SYMBOL");
  await prisma.$transaction([
    prisma.watchlistItem.deleteMany({ where: { userId } }),
    prisma.watchlistItem.createMany({ data: clean.map((symbol, position) => ({ userId, symbol, position })) }),
  ]);
  return clean;
}
