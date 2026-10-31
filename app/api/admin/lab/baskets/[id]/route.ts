import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { deleteBasket } from "@/lib/lab/data/basket";

export const dynamic = "force-dynamic";

export const DELETE = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  await deleteBasket(admin.id, id);
  return NextResponse.json({ ok: true });
});
