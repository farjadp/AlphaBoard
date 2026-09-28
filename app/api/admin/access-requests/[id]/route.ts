import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { readJson } from "@/lib/http/errors";
import { requireAdmin } from "@/lib/auth/dal";
import { dismissAccessRequest, inviteFromRequest } from "@/lib/access/requests";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["invite", "dismiss"]) });

/** invite → returns the one-time invite URL (bound to the requester's email); dismiss → hides the request. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const { action } = Body.parse(await readJson(req, 500));
  if (action === "invite") return NextResponse.json(await inviteFromRequest(admin.id, id), { status: 201 });
  await dismissAccessRequest(admin.id, id);
  return NextResponse.json({ ok: true });
});
