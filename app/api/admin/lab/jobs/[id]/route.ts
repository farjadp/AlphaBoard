import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAdmin } from "@/lib/auth/dal";
import { getLabJob } from "@/lib/lab/jobs";

export const dynamic = "force-dynamic";

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  const { id } = await params;
  return NextResponse.json({ job: await getLabJob(admin.id, id) });
});
