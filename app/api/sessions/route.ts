import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { SessionStartInput } from "@/lib/db/inputs";
import { dailyUsage } from "@/lib/sessions/limits";
import { listSessions, sessionView, startSession } from "@/lib/sessions/service";

export const dynamic = "force-dynamic";

/** The user's sessions (newest first) and today's usage against the daily limits. */
export const GET = userRoute(async (_req, user) => {
  const [sessions, usage] = await Promise.all([listSessions(user.id), dailyUsage(user.id)]);
  return NextResponse.json({ sessions, usage });
});

/** Start a session under a mandate (paper only until live venues arrive). */
export const POST = userRoute(async (req, user) => {
  const input = SessionStartInput.parse(await readJson(req, 8_000));
  const s = await startSession(user.id, input);
  return NextResponse.json(await sessionView(user.id, s.id), { status: 201 });
});
