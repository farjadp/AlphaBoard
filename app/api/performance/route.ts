import { NextResponse } from "next/server";
import { z } from "zod";
import { userRoute } from "@/lib/http/userRoute";
import { userPerformance } from "@/lib/eval/performance";

export const dynamic = "force-dynamic";

const Query = z.object({
  symbol: z.string().max(30).optional(),
  timeframe: z.string().max(10).optional(),
  model: z.string().max(80).optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
});

/** Evaluated-signal metrics for the signed-in user (same data as /performance). */
export const GET = userRoute(async (req, user) => {
  const q = Object.fromEntries([...new URL(req.url).searchParams].filter(([, v]) => v !== ""));
  return NextResponse.json(await userPerformance(user.id, Query.parse(q)));
});
