import { NextResponse } from "next/server";
import { z } from "zod";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { markNotificationsRead } from "@/lib/notify/notifications";

export const dynamic = "force-dynamic";

const Body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().max(40)).min(1).max(100) })]);

export const POST = userRoute(async (req, user) => {
  const b = Body.parse(await readJson(req, 8_000));
  return NextResponse.json(await markNotificationsRead(user.id, "all" in b ? "all" : b.ids));
});
