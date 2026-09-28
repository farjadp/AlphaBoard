import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { ChartLessonInput } from "@/lib/db/inputs";
import { clearChartLessons, createChartLesson, listChartLessons } from "@/lib/db/chartLessons";

export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, user) => NextResponse.json({ lessons: await listChartLessons(user.id) }));

export const POST = userRoute(async (req, user) =>
  NextResponse.json({ lesson: await createChartLesson(user.id, ChartLessonInput.parse(await readJson(req, 6_800_000))) }, { status: 201 }));

export const DELETE = userRoute(async (_req, user) => {
  await clearChartLessons(user.id);
  return new NextResponse(null, { status: 204 });
});
