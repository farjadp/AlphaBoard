import { NextResponse } from "next/server";
import { userIdRoute } from "@/lib/http/userRoute";
import { notFound } from "@/lib/http/errors";
import { getAttachment } from "@/lib/db/attachments";

/** Owner-only image download. Never served to other users, never cached by shared caches. */
export const GET = userIdRoute(async (_req, user, id) => {
  const a = await getAttachment(user.id, id);
  if (!a) throw notFound("Attachment not found");
  return new NextResponse(new Uint8Array(a.bytes), {
    headers: {
      "Content-Type": a.mime,
      "Content-Length": String(a.size),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
});
