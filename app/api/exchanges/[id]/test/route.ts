import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { requireExchangeAccess, testConnection } from "@/lib/exchanges/connections";

export const dynamic = "force-dynamic";

/** Load markets and read the balance with the stored keys; records OK / ERROR. */
export const POST = userIdRoute(async (_req, user, id) => {
  requireExchangeAccess(user);
  return NextResponse.json(await testConnection(user.id, id));
});
