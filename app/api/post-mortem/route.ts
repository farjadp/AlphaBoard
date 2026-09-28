import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { requireUser } from "@/lib/auth/dal";
import { readJson } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { parseImageDataUrl } from "@/lib/http/images";
import { badRequest } from "@/lib/http/errors";
import { attachmentAsDataUrl, attachmentIdFromUrl } from "@/lib/db/attachments";
import { openaiChatJson, type ContentPart } from "@/lib/ai/openai";
import { PostMortemSchema } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

const str = (max: number) => z.string().max(max).optional();
const numOpt = z.coerce.number().finite().optional().catch(undefined);

const Body = z.object({
  symbol: str(30),
  position: z.enum(["LONG", "SHORT", "SPOT"]).optional(),
  entryPrice: numOpt,
  exitPrice: numOpt,
  pnlPercent: numOpt,
  emotion: str(30),
  leverage: numOpt,
  margin: numOpt,
  marginMode: str(20),
  notes: str(2_000),
  context: str(2_000),
  status: z.enum(["OPEN", "CLOSED"]).optional(),
  image: z.string().optional(),
});

function deriveOutcome(b: z.output<typeof Body>) {
  if (b.status === "OPEN" || typeof b.pnlPercent !== "number") return "OPEN";
  if (b.pnlPercent > 0.2) return "WIN";
  if (b.pnlPercent < -0.2) return "LOSS";
  return "BREAKEVEN";
}

/** No heuristic fallback any more: if the AI is unavailable the client is told so (503), not handed canned advice. */
export const POST = route(async (req) => {
  const user = await requireUser();
  enforceRateLimit(req, "ai");
  const b = Body.parse(await readJson(req, 2_300_000));
  // The screenshot is either freshly uploaded (data URL) or already stored on the trade.
  const storedId = attachmentIdFromUrl(b.image);
  if (storedId) {
    const dataUrl = await attachmentAsDataUrl(user.id, storedId);
    if (!dataUrl) throw badRequest("Unknown screenshot", "BAD_ATTACHMENT");
    b.image = dataUrl;
  } else if (b.image) {
    parseImageDataUrl(b.image);
  }
  const outcome = deriveOutcome(b);

  const tradeBlock = [
    `Symbol: ${b.symbol ?? "n/a"}`, `Position: ${b.position ?? "n/a"}`, `Status: ${b.status ?? "n/a"}`,
    `Entry price: ${b.entryPrice ?? "n/a"}`, `Exit price: ${b.exitPrice ?? "n/a"}`, `PnL %: ${b.pnlPercent ?? "n/a"}`,
    `Leverage: ${b.leverage ?? "n/a"}`, `Margin: ${b.margin ?? "n/a"}`, `Margin mode: ${b.marginMode ?? "n/a"}`,
    `Trader emotion: ${b.emotion ?? "n/a"}`, `Trader notes: ${b.notes || "(none)"}`, `Additional context: ${b.context || "(none)"}`,
    `Derived outcome: ${outcome}`,
  ].join("\n");

  const instructions = `Perform a post-mortem on this trade${b.image ? " using the data and the attached chart/PnL screenshot" : ""}.
Return ONLY a JSON object with these keys:
- "outcome": "WIN" | "LOSS" | "BREAKEVEN" | "OPEN" (use the derived outcome unless the data clearly contradicts it)
- "rootCause": 2–3 sentences on the real driver of the result: market structure, liquidity, sizing, or behaviour. No generic reasons.
- "mistakes": 0–4 specific errors, max 20 words each
- "strengths": 0–4 specific strengths, max 20 words each
- "lesson": 2–3 sentences of actionable, non-generic insight. Avoid beginner advice such as "use lower leverage" or "always use a stop loss".
- "tags": 3–6 lowercase kebab-case tags (e.g. "liquidity-grab", "sizing-error")
If Status is CLOSED with an exit price and PnL, treat the trade as closed even if the screenshot shows it open (the screenshot may predate the close).

Trade data:
${tradeBlock}`;

  const content: ContentPart[] = [{ type: "text", text: instructions }];
  if (b.image) content.push({ type: "image_url", image_url: { url: b.image, detail: "high" } });

  const result = await openaiChatJson({
    feature: "post-mortem",
    userId: user.id,
    system: "You are a blunt, experienced trading coach. Respond with a single JSON object only.",
    user: content,
    schema: PostMortemSchema,
    model: b.image ? undefined : process.env.OPENAI_MODEL_SMALL ?? "gpt-4o-mini",
    maxTokens: 900,
    temperature: 0.3,
  });
  return NextResponse.json({ ...result, tags: result.tags.map((t) => t.toLowerCase()) });
});
