import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { badRequest, readJson } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { parseImageDataUrl } from "@/lib/http/images";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { aiJson, type ContentPart } from "@/lib/ai";
import { draftFromExtract, SIGNAL_EXTRACT_JSON, SIGNAL_EXTRACT_PROMPT, SignalExtractSchema } from "@/lib/signals/importDraft";

export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().trim().max(4_000).optional(), image: z.string().optional() });

/** "Paste a signal": text and/or a screenshot → a form draft with warnings. Nothing is stored or sent. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "ai");
  const { text, image } = Body.parse(await readJson(req, 2_200_000));
  if (!text && !image) throw badRequest("paste the signal text or a screenshot");
  if (image) parseImageDataUrl(image);

  const content: ContentPart[] = [{ type: "text", text: SIGNAL_EXTRACT_PROMPT }];
  if (text) content.push({ type: "text", text: `Message:\n"""\n${text}\n"""` });
  if (image) content.push({ type: "image_url", image_url: { url: image, detail: "high" } });

  const { data } = await aiJson({
    feature: "signal-import",
    userId: admin.id,
    system: "You read trading signals exactly as written. Respond with a single JSON object only.",
    user: content,
    schema: SignalExtractSchema,
    jsonSchema: SIGNAL_EXTRACT_JSON,
    maxTokens: 400,
  });
  const device = await prisma.mt5Device.findFirst({ where: { userId: admin.id, revokedAt: null }, orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } }, select: { symbols: true } });
  return NextResponse.json(draftFromExtract(data, device?.symbols ?? []));
});
