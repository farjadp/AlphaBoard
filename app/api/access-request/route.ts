import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { readJson } from "@/lib/http/errors";
import { clientIp, enforceRateLimit } from "@/lib/http/rateLimit";
import { AccessRequestInput, submitAccessRequest } from "@/lib/access/requests";

export const dynamic = "force-dynamic";

/** Public waitlist signup from the landing page. Always the same answer (no account/email enumeration). */
export const POST = route(async (req) => {
  enforceRateLimit(req, "public");
  await submitAccessRequest(AccessRequestInput.parse(await readJson(req, 4_000)), clientIp(req));
  return NextResponse.json({ ok: true }, { status: 202 });
});
