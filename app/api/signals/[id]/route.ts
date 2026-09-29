import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { deleteSignal } from "@/lib/db/signals";

export const DELETE = userIdRoute(async (_req, user, id) => {
  await deleteSignal(user.id, id);
  return new NextResponse(null, { status: 204 });
});
