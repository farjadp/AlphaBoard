import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { z } from "zod";
import { badRequest, readJson } from "@/lib/http/errors";
import { createDevice, listDevices, revokeDevice } from "@/lib/signalDesk/devices";

export const dynamic = "force-dynamic";

/** The admin's active MT5 terminals (never the token hash). */
export const GET = adminRoute(async (req, admin) => {
  const devices = await listDevices(admin.id);
  return NextResponse.json({ devices });
});

/** New terminal token, returned this once. */
export const POST = adminRoute(async (req, admin) => {
  const { label } = z.object({ label: z.string().trim().min(1).max(60) }).parse(await readJson(req, 1_000));
  const { device, token } = await createDevice(admin.id, label);
  await audit(admin.id, "signal_desk.device_create", { target: device.id });
  return NextResponse.json({ device: { id: device.id, label: device.label, last4: device.last4 }, token }, { status: 201, headers: { "cache-control": "no-store" } });
});

/** Revoke a terminal: `DELETE ?id=<deviceId>`. */
export const DELETE = adminRoute(async (req, admin) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw badRequest("id is required");
  await revokeDevice(admin.id, id);
  await audit(admin.id, "signal_desk.device_revoke", { target: id });
  return NextResponse.json({ ok: true });
});
