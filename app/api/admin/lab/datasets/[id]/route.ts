import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { deleteDataset } from "@/lib/lab/data/store";

export const dynamic = "force-dynamic";

export const DELETE = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  await deleteDataset(admin.id, id);
  return NextResponse.json({ ok: true });
});
