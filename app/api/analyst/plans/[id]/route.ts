import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/auth/audit";
import { activatePlan, archivePlan, deletePlan, updatePlan } from "@/lib/analyst/store";
import { readJson } from "@/lib/http/errors";
import { adminRoute } from "@/lib/http/userRoute";

export const dynamic = "force-dynamic";

const Action = z.object({ action: z.enum(["activate", "archive"]) });

/** `{ action: "activate" | "archive" }`, or a field patch on a draft. */
export const PATCH = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  const body = await readJson(req, 20_000);
  const act = Action.safeParse(body);
  if (act.success) {
    if (act.data.action === "activate") await activatePlan(admin.id, id);
    else await archivePlan(admin.id, id);
    await audit(admin.id, `analyst.plan_${act.data.action}`, { target: id });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ plan: await updatePlan(admin.id, id, body as Parameters<typeof updatePlan>[2]) });
});

/** Discard a draft. */
export const DELETE = adminRoute(async (_req, admin, { params }) => {
  const { id } = await params;
  await deletePlan(admin.id, id);
  return NextResponse.json({ ok: true });
});
