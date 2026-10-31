import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { badRequest, payloadTooLarge } from "@/lib/http/errors";
import { listDatasets, saveDataset } from "@/lib/lab/data/store";
import { parseMt5Csv } from "@/lib/lab/data/mt5csv";
import { LabDataError } from "@/lib/lab/data/encode";

export const dynamic = "force-dynamic";

/** An ExportM1 CSV of a year of M1 bars is ~26 MB. */
const MAX_UPLOAD = 60 * 1024 * 1024;

export const GET = adminRoute(async (req, admin) => {
  return NextResponse.json({ datasets: await listDatasets(admin.id) });
});

/** Upload an MT5 ExportM1 CSV (multipart field "file", optional "symbol" to name it). */
export const POST = adminRoute(async (req, admin) => {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD) throw payloadTooLarge(MAX_UPLOAD);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("attach the ExportM1 CSV as the field \"file\"");
  if (file.size > MAX_UPLOAD) throw payloadTooLarge(MAX_UPLOAD);
  // The page sends the file's own size; a mismatch means the body was cut somewhere on the way.
  const declared = Number(form?.get("size") ?? NaN);
  if (Number.isFinite(declared) && declared !== file.size) throw badRequest(`the upload arrived incomplete (${file.size} of ${declared} bytes) — try again`, "LAB_UPLOAD_TRUNCATED");
  let parsed;
  try {
    parsed = parseMt5Csv(await file.text());
  } catch (e) {
    if (e instanceof LabDataError) throw badRequest(e.message, "LAB_BAD_FILE");
    throw e;
  }
  const name = String(form?.get("symbol") ?? "").trim().slice(0, 30) || parsed.symbol;
  const ds = await saveDataset(admin.id, { symbol: name, source: "mt5csv", timeframe: "1m" }, parsed.bars, parsed.spread);
  await audit(admin.id, "admin.lab_upload", { target: ds.id });
  return NextResponse.json({ dataset: ds }, { status: 201 });
});
