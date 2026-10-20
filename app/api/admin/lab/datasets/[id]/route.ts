import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAdmin } from "@/lib/auth/dal";
import { deleteDataset } from "@/lib/lab/data/store";

export const dynamic = "force-dynamic";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  const { id } = await params;
  await deleteDataset(admin.id, id);
  return NextResponse.json({ ok: true });
});
