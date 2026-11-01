import "server-only";
import { prisma } from "@/lib/db/client";
import { NEWS_LAST_KEY, type NewsJobResult } from "./job";

/** What Admin → News shows besides the reports: last pass, weight runs, change log, 24 h article count. */
export async function newsAdminData(now = new Date()) {
  const [lastRow, runs, changes, articles24h] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: NEWS_LAST_KEY } }),
    prisma.newsWeightRun.findMany({ orderBy: { at: "desc" }, take: 8 }),
    prisma.publisherWeightChange.findMany({ orderBy: { createdAt: "desc" }, take: 40, include: { publisher: { select: { name: true } } } }),
    prisma.newsArticle.count({ where: { fetchedAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
  ]);
  return { last: lastRow?.value as NewsJobResult | undefined, runs, changes, articles24h };
}
