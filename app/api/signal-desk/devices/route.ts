import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { badRequest } from "@/lib/http/errors";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { createDevice, revokeDevice } from "@/lib/mt5/devices";

export const dynamic = "force-dynamic";

const PUBLIC = { id: true, label: true, last4: true, login: true, server: true, tradeMode: true, balance: true, currency: true, symbols: true, lastSeenAt: true, createdAt: true } as const;

/** The admin's active MT5 terminals (never the token hash). */
export const GET = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  const devices = await prisma.mt5Device.findMany({ where: { userId: admin.id, revokedAt: null }, orderBy: { createdAt: "desc" }, select: PUBLIC });
  return NextResponse.json({ devices });
});

/** New terminal token, returned this once. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  const { label } = z.object({ label: z.string().trim().min(1).max(60) }).parse(await req.json().catch(() => null));
  const { device, token } = await createDevice(admin.id, label);
  await prisma.auditLog.create({ data: { userId: admin.id, action: "signal_desk.device_create", target: device.id } });
  return NextResponse.json({ device: { id: device.id, label: device.label, last4: device.last4 }, token }, { status: 201, headers: { "cache-control": "no-store" } });
});

/** Revoke a terminal: `DELETE ?id=<deviceId>`. */
export const DELETE = route(async (req) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw badRequest("id is required");
  await revokeDevice(admin.id, id);
  await prisma.auditLog.create({ data: { userId: admin.id, action: "signal_desk.device_revoke", target: id } });
  return NextResponse.json({ ok: true });
});
