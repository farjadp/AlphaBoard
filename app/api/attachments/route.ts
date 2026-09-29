import { NextResponse } from "next/server";
import { z } from "zod";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { createAttachment } from "@/lib/db/attachments";

/** Upload one image (data URL, ≤1.5 MB). Used by the import flow; features upload inline. */
export const POST = userRoute(async (req, user) => {
  const { dataUrl } = z.object({ dataUrl: z.string() }).parse(await readJson(req, 2_200_000));
  return NextResponse.json(await createAttachment(user.id, dataUrl), { status: 201 });
});
