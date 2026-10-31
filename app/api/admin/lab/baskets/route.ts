import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { listBaskets } from "@/lib/lab/data/basket";

export const dynamic = "force-dynamic";

/** Coin baskets of the signed-in admin (built by a { kind: "basket" } job). */
export const GET = adminRoute(async (req, admin) => {
  return NextResponse.json({ baskets: await listBaskets(admin.id) });
});
