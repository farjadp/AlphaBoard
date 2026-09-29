import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { listMessages } from "@/lib/sessions/room";

export const dynamic = "force-dynamic";

/** Room messages after `?after=<messageId>` (oldest first). */
export const GET = userIdRoute(async (req, user, id) => {
  const after = new URL(req.url).searchParams.get("after");
  return NextResponse.json({ messages: await listMessages(user.id, id, after && after.length <= 40 ? after : null) });
});
