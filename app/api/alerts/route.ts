import { NextResponse } from "next/server";
import { userRoute } from "@/lib/http/userRoute";
import { readJson } from "@/lib/http/errors";
import { AlertInput } from "@/lib/db/inputs";
import { createAlert, listAlerts } from "@/lib/db/alerts";

export const dynamic = "force-dynamic";

export const GET = userRoute(async (_req, user) => NextResponse.json({ alerts: await listAlerts(user.id) }));

export const POST = userRoute(async (req, user) =>
  NextResponse.json({ alert: await createAlert(user.id, AlertInput.parse(await readJson(req, 2_000))) }, { status: 201 }));
