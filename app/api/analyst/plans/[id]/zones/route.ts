import { NextResponse } from "next/server";
import { addZone } from "@/lib/analyst/store";
import { readJson } from "@/lib/http/errors";
import { adminRoute } from "@/lib/http/userRoute";

export const dynamic = "force-dynamic";

/** Add a zone by hand to a draft plan. */
export const POST = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  const zone = await addZone(admin.id, id, (await readJson(req, 5_000)) as Parameters<typeof addZone>[2]);
  return NextResponse.json({ zone }, { status: 201 });
});
