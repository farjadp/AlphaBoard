import { audit } from "@/lib/auth/audit";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { badRequest, readJson } from "@/lib/http/errors";
import { createSignal, listSignals } from "@/lib/signalDesk/service";

export const dynamic = "force-dynamic";

/** The admin's latest signals with their legs (newest first). */
export const GET = adminRoute(async (req, admin) => {
  const signals = await listSignals(admin.id);
  return NextResponse.json({ signals });
});

/** Write a signal: posted to the channel and/or queued for SignalCopier (see lib/signalDesk/service.ts). */
export const POST = adminRoute(async (req, admin) => {
  const body = await readJson(req, 20_000);
  if (!body || typeof body !== "object") throw badRequest("send the signal as JSON");
  const { signal, warnings } = await createSignal(admin.id, body);
  await audit(admin.id, "signal_desk.create", { target: signal.id });
  return NextResponse.json({ signal, warnings }, { status: 201 });
});
