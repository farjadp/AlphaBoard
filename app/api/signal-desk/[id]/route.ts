import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { queueCommand } from "@/lib/signals/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ command: z.enum(["CANCEL", "CLOSE_ALL", "BREAKEVEN"]) });

/** CANCEL a signal no terminal has taken, or queue CLOSE_ALL / BREAKEVEN for an open one. */
export const POST = route<Ctx>(async (req, ctx) => {
  const admin = await requireAdmin();
  enforceRateLimit(req, "api");
  const { id } = await ctx.params;
  const { command } = body.parse(await req.json().catch(() => null));
  await queueCommand(admin.id, id, command);
  await prisma.auditLog.create({ data: { userId: admin.id, action: `signal_desk.${command.toLowerCase()}`, target: id } });
  return NextResponse.json({ ok: true });
});
