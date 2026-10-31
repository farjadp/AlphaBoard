import { audit } from "@/lib/auth/audit";
import { readJson } from "@/lib/http/errors";
import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/http/userRoute";
import { z } from "zod";
import { queueCommand } from "@/lib/signals/service";

export const dynamic = "force-dynamic";

const price = z.number().finite().positive();
const body = z.discriminatedUnion("command", [
  z.object({ command: z.enum(["CANCEL", "CLOSE_ALL", "BREAKEVEN"]) }),
  z.object({ command: z.literal("MOVE_SL"), price }),
  z.object({ command: z.literal("MOVE_TP"), leg: z.number().int().positive(), price }),
  z.object({ command: z.literal("CLOSE_PARTIAL"), fraction: z.number().gt(0).lt(1) }),
]);

/** CANCEL a signal no terminal has taken, or queue CLOSE_ALL / BREAKEVEN for an open one. */
export const POST = adminRoute(async (req, admin, { params }) => {
  const { id } = await params;
  const cmd = body.parse(await readJson(req, 1_000));
  await queueCommand(admin.id, id, cmd as Parameters<typeof queueCommand>[2]);
  await audit(admin.id, `signal_desk.${cmd.command.toLowerCase()}`, { target: id, meta: cmd });
  return NextResponse.json({ ok: true });
});
