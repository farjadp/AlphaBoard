import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { parseLegacyData } from "@/lib/import/legacy";
import { importLegacyData } from "@/lib/db/importLegacy";

/**
 * Import v1 browser data. Images must be uploaded first (POST /api/attachments) and referenced by
 * attachmentId; any still-embedded data URL is ignored here. The payload is re-validated server-side.
 */
export const POST = userRoute(async (req, user) => {
  const data = parseLegacyData(await readJson(req, 8_000_000));
  const imported = await importLegacyData(user.id, data);
  return NextResponse.json({ imported, skipped: data.skipped });
});
