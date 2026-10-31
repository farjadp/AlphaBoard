import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { readJson } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { enqueueLabJob, listLabJobs } from "@/lib/lab/jobs";

export const dynamic = "force-dynamic";

/** Strategy Lab jobs of the signed-in admin (downloads and studies), newest first. */
export const GET = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  return NextResponse.json({ jobs: await listLabJobs(admin.id) });
});

/** Queue a download ({ kind: "fetch", … }) or a study ({ kind: "ladder", … }). */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  const job = await enqueueLabJob(admin.id, await readJson(req, 20_000));
  await prisma.auditLog.create({ data: { userId: admin.id, action: `admin.lab_${job.kind.toLowerCase()}`, target: job.id } });
  return NextResponse.json({ job }, { status: 201 });
});
