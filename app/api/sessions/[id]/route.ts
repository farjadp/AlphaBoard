import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { sessionView } from "@/lib/sessions/service";

export const dynamic = "force-dynamic";

export const GET = userIdRoute(async (_req, user, id) => NextResponse.json(await sessionView(user.id, id)));
