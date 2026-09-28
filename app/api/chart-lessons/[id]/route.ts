import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { deleteChartLesson } from "@/lib/db/chartLessons";

export const DELETE = userIdRoute(async (_req, user, id) => {
  await deleteChartLesson(user.id, id);
  return new NextResponse(null, { status: 204 });
});
