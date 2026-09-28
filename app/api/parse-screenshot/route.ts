import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { readJson } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { parseImageDataUrl } from "@/lib/http/images";
import { openaiChatJson } from "@/lib/ai/openai";
import { TradeScreenshotSchema } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

const Body = z.object({ image: z.string() });

const INSTRUCTIONS = `Extract trade details from this crypto exchange screenshot. It may be a position record, order history, open-positions page, or a "Share PnL" card.

Rules, in priority order:
1. If it is a "Share PnL" card (big % number, entry price, average close price), read that card, not the surrounding UI.
2. Prefer labelled values: "Avg Entry Price", "Avg Close Price", "Entry Price", "Exit Price", "Close Price".
3. Leverage appears as "10x", "6X", "50X" or in a tag like "Perp | Long | 6X". Return the number only.
4. Take LONG/SHORT from an explicit label, never from colour alone.
5. "Margin" is the collateral (smaller number); "Size"/"Position Size" is margin × leverage. Use Margin for the margin field.
6. If a field is missing or ambiguous, return null. Do not guess.

Return ONLY a JSON object with these keys:
"symbol" (e.g. "BTC/USDT"; add the slash if missing), "position" ("LONG" | "SHORT" | null), "entryPrice", "exitPrice" (null if still open), "leverage", "margin" (USD collateral), "marginMode" ("Cross" | "Isolated" | null), "pnlPercent" (signed, e.g. -2.24), "pnlUsd" (signed). Numbers as JSON numbers or null.`;

export const POST = route(async (req) => {
  const user = await requireUser();
  enforceRateLimit(req, "ai");
  const { image } = Body.parse(await readJson(req, 2_200_000));
  parseImageDataUrl(image);

  const trade = await openaiChatJson({
    feature: "parse-screenshot",
    userId: user.id,
    system: "You extract exact values from exchange screenshots. Respond with a single JSON object only.",
    user: [
      { type: "text", text: INSTRUCTIONS },
      { type: "image_url", image_url: { url: image, detail: "high" } },
    ],
    schema: TradeScreenshotSchema,
    maxTokens: 400,
  });
  return NextResponse.json(trade);
});
