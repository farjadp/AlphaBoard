import { dbAndTick } from "@/lib/ops/health";
import { NextResponse } from "next/server";
import { appVersion } from "@/lib/config/version";
import { route } from "@/lib/http/route";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

export const GET = route(async () => {
  const { db, tick } = await dbAndTick();
  const body = {
    ok: db === "ok",
    db,
    tick,
    version: appVersion(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});
