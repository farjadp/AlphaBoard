import { NextResponse } from "next/server";
import { deleteZone, updateZone } from "@/lib/analyst/store";
import { readJson } from "@/lib/http/errors";
import { adminRoute } from "@/lib/http/userRoute";

export const dynamic = "force-dynamic";

/** Edit or confirm a zone of a draft plan. */
export const PATCH = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  return NextResponse.json({ zone: await updateZone(admin.id, id, (await readJson(req, 5_000)) as Parameters<typeof updateZone>[2]) });
});

export const DELETE = adminRoute(async (_req, admin, { params }) => {
  const { id } = await params;
  await deleteZone(admin.id, id);
  return NextResponse.json({ ok: true });
});
