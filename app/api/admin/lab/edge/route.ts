import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { badRequest, readJson } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { loadDataset } from "@/lib/lab/data/store";
import { edgeCheck } from "@/lib/lab/edge";

export const dynamic = "force-dynamic";

const Body = z.object({
  symbol: z.string().min(1).max(30),
  datasetId: z.string().min(1).max(40),
  who: z.enum(["all", "manual", "expert"]).default("all"),
}).strict();

/** Do the imported MT5 trades of a symbol beat random entries on a Lab dataset of the same market? */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  const parsed = Body.safeParse(await readJson(req, 2_000));
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  const { symbol, datasetId, who } = parsed.data;
  const ds = await loadDataset(admin.id, datasetId);
  const rows = await prisma.mt5Trade.findMany({
    where: { userId: admin.id, symbol, ...(who === "manual" ? { manual: true } : who === "expert" ? { manual: false } : {}) },
    orderBy: { openedAt: "asc" },
  });
  const result = edgeCheck(rows.map((r) => ({
    side: r.side as "LONG" | "SHORT", entryTime: r.openedAt.getTime(), entryPrice: r.entryPrice, stop: r.stop,
    exitTime: r.closedAt.getTime(), exitPrice: r.exitPrice,
  })), ds.bars, { samples: 100, seed: 1 });
  return NextResponse.json({ result, dataset: ds.meta, symbol, who });
});
