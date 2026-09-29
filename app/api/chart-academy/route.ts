import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { readJson } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { parseImageDataUrl } from "@/lib/http/images";
import { aiJson, type ContentPart } from "@/lib/ai";
import { JSON_SCHEMAS } from "@/lib/ai/jsonSchemas";
import { ChartAcademySchema } from "@/lib/ai/schemas";
import { buildPrompt } from "@/lib/ai/prompts/chartAcademy";

export const dynamic = "force-dynamic";

const Body = z.object({
  charts: z.array(z.object({
    timeframe: z.enum(["15m", "1H", "4H", "1D"]),
    imageDataUrl: z.string(),
  })).min(1, "Upload at least one chart").max(3, "Maximum 3 charts"),
});

/** No mock response any more: without an API key this returns 503 instead of a fabricated BUY. */
export const POST = route(async (req) => {
  const user = await requireUser();
  enforceRateLimit(req, "ai");
  const { charts } = Body.parse(await readJson(req, 6_800_000));
  charts.forEach((c) => parseImageDataUrl(c.imageDataUrl));

  const content: ContentPart[] = [{ type: "text", text: buildPrompt(charts.map((c) => c.timeframe)) }];
  for (const c of charts) {
    content.push({ type: "text", text: `=== CHART IMAGE: ${c.timeframe} TIMEFRAME ===\ny=0 is the top of the image (highest price), y=100 the bottom. The current price is near the rightmost candle body.` });
    content.push({ type: "image_url", image_url: { url: c.imageDataUrl, detail: "high" } });
  }

  const { data: result } = await aiJson({
    feature: "chart-academy",
    userId: user.id,
    system: "You are a precise chart analyst who annotates screenshots. Respond with a single JSON object only.",
    user: content,
    schema: ChartAcademySchema,
    jsonSchema: JSON_SCHEMAS.chartAcademy,
    maxTokens: 8_000,
    timeoutMs: 120_000,
  });
  return NextResponse.json(result);
});
