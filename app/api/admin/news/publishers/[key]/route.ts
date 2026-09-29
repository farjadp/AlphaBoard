import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/auth/dal";
import { readJson } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { setPublisherWeight } from "@/lib/news/weights";

const Body = z.object({ weight: z.number(), reason: z.string().trim().min(3).max(500) });

/** Admin override of a publisher's credibility weight (logged next to the agent's changes). */
export const PATCH = route<{ params: Promise<{ key: string }> }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { key } = await params;
  const { weight, reason } = Body.parse(await readJson(req, 1_000));
  await setPublisherWeight(key, weight, admin.id, reason);
  await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.news_weight", target: key, meta: { weight, reason } } });
  return NextResponse.json({ ok: true });
});
