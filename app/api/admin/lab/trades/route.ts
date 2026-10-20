import { NextResponse } from "next/server";
import { route } from "@/lib/http/route";
import { badRequest, payloadTooLarge } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { importDeals, listMt5Trades } from "@/lib/mt5/import";

export const dynamic = "force-dynamic";

/** A deal history CSV is small (years of deals ≈ 1 MB); stay well under the proxy's 10 MB buffer. */
const MAX_UPLOAD = 8 * 1024 * 1024;

export const GET = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  return NextResponse.json({ trades: await listMt5Trades(admin.id) });
});

/** Import an ExportDeals.mq5 CSV (multipart field "file"). */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD) throw payloadTooLarge(MAX_UPLOAD);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("attach the ExportDeals CSV as the field \"file\"");
  if (file.size > MAX_UPLOAD) throw payloadTooLarge(MAX_UPLOAD);
  const r = await importDeals(admin.id, await file.text());
  await prisma.auditLog.create({ data: { userId: admin.id, action: "admin.mt5_import", target: r.login } });
  return NextResponse.json(r, { status: 201 });
});
