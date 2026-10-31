import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { revertWeightChange } from "@/lib/news/weights";

/** Undo the latest weight change of a publisher. */
export const POST = adminRoute(async (_req, admin, { params }) => {
  const { id } = await params;
  await revertWeightChange(id, admin.id);
  await audit(admin.id, "admin.news_weight_revert", { target: id });
  return NextResponse.json({ ok: true });
});
