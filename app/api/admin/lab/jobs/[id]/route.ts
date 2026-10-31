import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { getLabJob } from "@/lib/lab/jobs";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  return NextResponse.json({ job: await getLabJob(admin.id, id) });
});
