import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { deleteConnection, requireExchangeAccess } from "@/lib/exchanges/connections";

export const dynamic = "force-dynamic";

export const DELETE = userIdRoute(async (_req, user, id) => {
  requireExchangeAccess(user);
  await deleteConnection(user.id, id);
  return new NextResponse(null, { status: 204 });
});
