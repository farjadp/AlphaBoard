import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { deleteLesson } from "@/lib/db/lessons";

export const DELETE = userIdRoute(async (_req, user, id) => {
  await deleteLesson(user.id, id);
  return new NextResponse(null, { status: 204 });
});
