import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";

export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, user) =>
  NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }));
