import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { LessonInput } from "@/lib/db/inputs";
import { clearLessons, listLessons, saveLesson } from "@/lib/db/lessons";

export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, user) => NextResponse.json({ lessons: await listLessons(user.id) }));

export const POST = userRoute(async (req, user) =>
  NextResponse.json({ lesson: await saveLesson(user.id, LessonInput.parse(await readJson(req, 16_000))) }, { status: 201 }));

export const DELETE = userRoute(async (_req, user) => {
  await clearLessons(user.id);
  return new NextResponse(null, { status: 204 });
});
