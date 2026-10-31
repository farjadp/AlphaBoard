import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { z } from "zod";
import { readJson } from "@/lib/http/errors";
import { dismissAccessRequest, inviteFromRequest } from "@/lib/access/requests";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["invite", "dismiss"]) });

/** invite → returns the one-time invite URL (bound to the requester's email); dismiss → hides the request. */
export const POST = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  const { action } = Body.parse(await readJson(req, 500));
  if (action === "invite") return NextResponse.json(await inviteFromRequest(admin.id, id), { status: 201 });
  await dismissAccessRequest(admin.id, id);
  return NextResponse.json({ ok: true });
});
