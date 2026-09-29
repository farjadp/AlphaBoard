import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { SessionControlInput } from "@/lib/db/inputs";
import { endSession, extendSession, killSession, pauseSession, resumeSession, sessionView } from "@/lib/sessions/service";

export const dynamic = "force-dynamic";

/** Pause / resume / extend / end / kill. Returns the updated session. */
export const POST = userIdRoute(async (req, user, id) => {
  const c = SessionControlInput.parse(await readJson(req, 1_000));
  if (c.action === "pause") await pauseSession(user.id, id);
  else if (c.action === "resume") await resumeSession(user.id, id);
  else if (c.action === "kill") await killSession(user.id, id);
  else if (c.action === "extend") await extendSession(user.id, id, c.minutes);
  else await endSession(user.id, id, c.mode);
  return NextResponse.json(await sessionView(user.id, id));
});
