import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { badRequest, readJson } from "@/lib/http/errors";
import { prisma } from "@/lib/prisma";
import { createSignal } from "@/lib/signals/service";

export const dynamic = "force-dynamic";

/** The admin's latest signals with their legs (newest first). */
export const GET = adminRoute(async (req, admin) => {
  const signals = await prisma.tradeSignal.findMany({
    where: { userId: admin.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { legs: { orderBy: { leg: "asc" } } },
  });
  return NextResponse.json({ signals });
});

/** Write a signal: posted to the channel and/or queued for SignalCopier (see lib/signals/service.ts). */
export const POST = adminRoute(async (req, admin) => {
  const body = await readJson(req, 20_000);
  if (!body || typeof body !== "object") throw badRequest("send the signal as JSON");
  const { signal, warnings } = await createSignal(admin.id, body);
  await prisma.auditLog.create({ data: { userId: admin.id, action: "signal_desk.create", target: signal.id } });
  return NextResponse.json({ signal, warnings }, { status: 201 });
});
