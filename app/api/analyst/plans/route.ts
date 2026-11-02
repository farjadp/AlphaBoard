import { NextResponse } from "next/server";
import { audit } from "@/lib/auth/audit";
import { createPlan, listPlans, scorecard } from "@/lib/analyst/store";
import { readJson } from "@/lib/http/errors";
import { adminRoute } from "@/lib/http/userRoute";

export const dynamic = "force-dynamic";

/** The owner's analyst plans (newest first) and the per-source scorecard. */
export const GET = adminRoute(async (_req, admin) => {
  const [plans, scores] = await Promise.all([listPlans(admin.id), scorecard(admin.id)]);
  return NextResponse.json({ plans, scores });
});

/** Save a reviewed draft (lib/analyst/store.ts validates every field). */
export const POST = adminRoute(async (req, admin) => {
  const plan = await createPlan(admin.id, (await readJson(req, 200_000)) as Parameters<typeof createPlan>[1]);
  await audit(admin.id, "analyst.plan_create", { target: plan.id });
  return NextResponse.json({ plan }, { status: 201 });
});
