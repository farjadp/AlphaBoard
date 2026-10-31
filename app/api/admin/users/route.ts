import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { listUsersWithUsageToday } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async (_req, _admin) => {
  return NextResponse.json({ users: await listUsersWithUsageToday() });
});
