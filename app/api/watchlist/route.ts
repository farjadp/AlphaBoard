import { NextResponse } from "next/server";
import { z } from "zod";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { getWatchlist, setWatchlist } from "@/lib/db/watchlist";

export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, user) => NextResponse.json({ symbols: await getWatchlist(user.id) }));

export const PUT = userRoute(async (req, user) => {
  const { symbols } = z.object({ symbols: z.array(z.string().max(30)).max(20) }).parse(await readJson(req, 4_000));
  return NextResponse.json({ symbols: await setWatchlist(user.id, symbols) });
});
