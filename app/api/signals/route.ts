import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { clearSignals, listSignals } from "@/lib/db/signals";

export const dynamic = "force-dynamic";

/** Signals are created server-side by /api/analyze; this route only lists and deletes. */
export const GET = userRoute(async (_req, user) => NextResponse.json({ signals: await listSignals(user.id) }));

export const DELETE = userRoute(async (_req, user) => {
  await clearSignals(user.id);
  return new NextResponse(null, { status: 204 });
});
