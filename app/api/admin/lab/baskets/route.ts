import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAdmin } from "@/lib/auth/dal";
import { listBaskets } from "@/lib/lab/data/basket";

export const dynamic = "force-dynamic";

/** Coin baskets of the signed-in admin (built by a { kind: "basket" } job). */
export const GET = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  return NextResponse.json({ baskets: await listBaskets(admin.id) });
});
