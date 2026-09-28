import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { deleteAlert } from "@/lib/db/alerts";

// Alerts are triggered only by the server tick (lib/alerts/job.ts); clients can create and delete them.

export const DELETE = userIdRoute(async (_req, user, id) => {
  await deleteAlert(user.id, id);
  return new NextResponse(null, { status: 204 });
});
