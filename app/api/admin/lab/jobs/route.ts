import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { enqueueLabJob, listLabJobs } from "@/lib/lab/jobs";

export const dynamic = "force-dynamic";

/** Strategy Lab jobs of the signed-in admin (downloads and studies), newest first. */
export const GET = adminRoute(async (req, admin) => {
  return NextResponse.json({ jobs: await listLabJobs(admin.id) });
});

/** Queue a download ({ kind: "fetch", … }) or a study ({ kind: "ladder", … }). */
export const POST = adminRoute(async (req, admin) => {
  const job = await enqueueLabJob(admin.id, await readJson(req, 20_000));
  await audit(admin.id, `admin.lab_${job.kind.toLowerCase()}`, { target: job.id });
  return NextResponse.json({ job }, { status: 201 });
});
