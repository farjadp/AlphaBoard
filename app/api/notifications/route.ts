import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { listNotifications } from "@/lib/notify/notifications";

export const dynamic = "force-dynamic";

/** Latest 50 notifications + unread count. */
export const GET = userRoute(async (_req, user) => NextResponse.json(await listNotifications(user.id)));
