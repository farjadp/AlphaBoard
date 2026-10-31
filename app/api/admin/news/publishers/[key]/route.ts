import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { z } from "zod";
import { readJson } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { setPublisherWeight } from "@/lib/news/weights";

const Body = z.object({ weight: z.number(), reason: z.string().trim().min(3).max(500) });

/** Admin override of a publisher's credibility weight (logged next to the agent's changes). */
export const PATCH = adminRoute(async (req, admin, { params }) => {
  const { key } = await params;
  const { weight, reason } = Body.parse(await readJson(req, 1_000));
  await setPublisherWeight(key, weight, admin.id, reason);
  await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.news_weight", target: key, meta: { weight, reason } } });
  return NextResponse.json({ ok: true });
});
