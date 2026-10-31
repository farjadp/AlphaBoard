import { NextResponse } from "next/server";
import { appVersion } from "@/lib/config/version";
import { prisma } from "@/lib/db/client";
import { route } from "@/lib/http/route";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

export const GET = route(async () => {
  let db: "ok" | "down" = "ok";
  let tick: { at: string; ms: number; errors: number } | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    const row = await prisma.appSetting.findUnique({ where: { key: "tick.last" } });
    const t = row?.value as { at?: string; ms?: number; errors?: unknown[] } | undefined;
    if (t?.at) tick = { at: t.at, ms: t.ms ?? 0, errors: t.errors?.length ?? 0 };
  } catch {
    db = "down";
  }
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
