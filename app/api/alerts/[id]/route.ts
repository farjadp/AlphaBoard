import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { deleteAlert, markAlertTriggered } from "@/lib/db/alerts";

/** PATCH marks the alert as triggered (idempotent). */
export const PATCH = userIdRoute(async (_req, user, id) => NextResponse.json({ alert: await markAlertTriggered(user.id, id) }));

export const DELETE = userIdRoute(async (_req, user, id) => {
  await deleteAlert(user.id, id);
  return new NextResponse(null, { status: 204 });
});
