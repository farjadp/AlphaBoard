import { readJson } from "@/lib/http/errors";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { queueCommand } from "@/lib/signals/service";

export const dynamic = "force-dynamic";

const body = z.object({ command: z.enum(["CANCEL", "CLOSE_ALL", "BREAKEVEN"]) });

/** CANCEL a signal no terminal has taken, or queue CLOSE_ALL / BREAKEVEN for an open one. */
export const POST = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  const { command } = body.parse(await readJson(req, 1_000));
  await queueCommand(admin.id, id, command);
  await prisma.auditLog.create({ data: { userId: admin.id, action: `signal_desk.${command.toLowerCase()}`, target: id } });
  return NextResponse.json({ ok: true });
});
