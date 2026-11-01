import { setUserQuota } from "@/lib/auth/users";
import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { z } from "zod";
import { readJson } from "@/lib/http/errors";

const Body = z.object({ dailyTokenQuota: z.number().int().min(0).max(50_000_000) });

/** Adjust a user's daily AI token allowance (0 disables AI for that user). */
export const PATCH = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  const { dailyTokenQuota } = Body.parse(await readJson(req, 500));
  const user = await setUserQuota(id, dailyTokenQuota);
  await audit(admin.id, "admin.user_quota", { target: user.email, meta: { dailyTokenQuota } });
  return NextResponse.json({ user });
});
