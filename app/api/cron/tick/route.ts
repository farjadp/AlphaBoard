import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { route } from "@/lib/http/route";
import { requireAdmin } from "@/lib/auth/dal";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { runTick } from "@/lib/jobs/tick";

export const dynamic = "force-dynamic";

function hasCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** External trigger for the scheduler tick: `Authorization: Bearer $CRON_SECRET`, or an admin session. */
export const POST = route(async (req) => {
  enforceRateLimit(req, "api");
  if (!hasCronSecret(req)) await requireAdmin();
  return NextResponse.json(await runTick());
});
