import { NextResponse } from "next/server";
import { z } from "zod";
import { aiJson } from "@/lib/ai";
import { ANALYST_EXTRACT_JSON, ANALYST_EXTRACT_PROMPT, AnalystExtractSchema, draftFromExtract } from "@/lib/analyst/extract";
import { feedPrices, isFuturesFeed } from "@/lib/analyst/feed";
import { readJson } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { adminRoute } from "@/lib/http/userRoute";

export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().trim().min(20).max(20_000) });

/** "Paste an analysis": text → a plan draft with warnings and the feed's last prices. Nothing is stored. */
export const POST = adminRoute(async (req, admin) => {
  await enforceRateLimit(req, "ai");
  const { text } = Body.parse(await readJson(req, 100_000));
  const { data } = await aiJson({
    feature: "analyst-extract",
    userId: admin.id,
    system: "You extract price zones from market analyses exactly as written. Respond with a single JSON object only.",
    user: `${ANALYST_EXTRACT_PROMPT}\n\nAnalysis:\n"""\n${text}\n"""`,
    schema: AnalystExtractSchema,
    jsonSchema: ANALYST_EXTRACT_JSON,
    maxTokens: 3_000,
  });
  const first = draftFromExtract(data, new Date());
  const symbols = [...new Set(first.zones.map((z) => z.symbol))];
  const feed = await feedPrices(symbols);
  return NextResponse.json({ draft: draftFromExtract(data, new Date(), feed), feed, futures: symbols.filter(isFuturesFeed) });
});
